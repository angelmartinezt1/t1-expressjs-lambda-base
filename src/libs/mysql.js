// src/libs/mysql.js
import mysql from 'mysql2/promise'
import { dbLogger as logger } from './logger.js'

// Conexión global que mantenemos entre invocaciones de Lambda
let pool = null

/**
 * Inicializa y retorna un pool de conexiones MySQL
 * Optimizado para entornos serverless como AWS Lambda
 */
const initializePool = async () => {
  if (pool) {
    logger.debug('Reutilizando pool de conexiones existente')
    return pool
  }

  logger.info('Inicializando nuevo pool de conexiones MySQL')

  try {
    // Configuración optimizada para AWS Lambda
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT || '3306', 10),
      // Configuración crucial para Lambda:
      connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
      queueLimit: 0,             // Sin límite en la cola de espera
      waitForConnections: true,  // Esperar por conexiones disponibles
      connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10),
      enableKeepAlive: true,     // Mantener conexiones vivas
      keepAliveInitialDelay: 10000, // 10 segundos para primer keepalive
      namedPlaceholders: true,   // Usar :nombreParam en consultas
    })

    // Suscribirse a eventos del pool para diagnóstico
    monitorPoolEvents()

    // Probar la conexión
    const connection = await pool.getConnection()
    await connection.ping()
    connection.release()

    logger.info({
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      connectionLimit: process.env.DB_CONNECTION_LIMIT || '10'
    }, 'Pool de conexiones MySQL inicializado correctamente')

    return pool
  } catch (error) {
    logger.error({ err: error }, 'Error al inicializar el pool de conexiones MySQL')
    pool = null // Reiniciar el pool en caso de error
    throw error
  }
}

/**
 * Monitorea eventos del pool para diagnóstico
 */
const monitorPoolEvents = () => {
  if (!pool) return

  pool.on('acquire', () => {
    logger.debug('Conexión adquirida del pool')
  })

  pool.on('connection', () => {
    logger.debug('Nueva conexión creada en el pool')
  })

  pool.on('enqueue', () => {
    logger.debug('Esperando por slot de conexión disponible')
  })

  pool.on('release', () => {
    logger.debug('Conexión liberada al pool')
  })
}

/**
 * Obtiene una conexión del pool
 * Útil para transacciones o consultas complejas
 */
const getConnection = async () => {
  try {
    const dbPool = await initializePool()
    return await dbPool.getConnection()
  } catch (error) {
    logger.error({ err: error }, 'Error al obtener conexión del pool')
    throw error
  }
}

/**
 * Ejecuta una consulta SQL con parámetros
 * @param {string} sql - Consulta SQL con placeholders
 * @param {Object|Array} params - Parámetros para la consulta (objeto para named params, array para ? params)
 * @returns {Promise<Array>} - Resultados de la consulta
 */
const query = async (sql, params = []) => {
  const startTime = Date.now()

  try {
    const dbPool = await initializePool()
    const [results] = await dbPool.query(sql, params)

    const duration = Date.now() - startTime

    // Solo logueamos a nivel debug para consultas normales
    logger.debug({
      sql: sanitizeSql(sql),
      params: sanitizeParams(params),
      rowCount: results?.length,
      duration: `${duration}ms`
    }, 'Consulta SQL ejecutada')

    return results
  } catch (error) {
    const duration = Date.now() - startTime

    // Para errores, usamos nivel error
    logger.error({
      err: error,
      sql: sanitizeSql(sql),
      params: sanitizeParams(params),
      duration: `${duration}ms`
    }, 'Error en consulta SQL')

    throw error
  }
}

/**
 * Ejecuta una transacción SQL
 * @param {Function} callback - Función que recibe una conexión y ejecuta operaciones en la transacción
 * @returns {Promise<any>} - Valor retornado por el callback
 */
const transaction = async (callback) => {
  const startTime = Date.now()
  let connection

  try {
    connection = await getConnection()
    await connection.beginTransaction()

    logger.debug('Transacción iniciada')

    const result = await callback(connection)
    await connection.commit()

    const duration = Date.now() - startTime
    logger.debug({ duration: `${duration}ms` }, 'Transacción completada exitosamente')

    return result
  } catch (error) {
    const duration = Date.now() - startTime

    if (connection) {
      try {
        await connection.rollback()
        logger.warn({ err: error, duration: `${duration}ms` }, 'Transacción revertida por error')
      } catch (rollbackError) {
        logger.error({
          err: rollbackError,
          originalError: error.message,
          duration: `${duration}ms`
        }, 'Error al revertir transacción')
      }
    }

    throw error
  } finally {
    if (connection) {
      connection.release()
    }
  }
}

/**
 * Cierra el pool de conexiones
 * Útil para pruebas y finalización limpia
 */
const closePool = async () => {
  if (pool) {
    try {
      await pool.end()
      pool = null
      logger.info('Pool de conexiones MySQL cerrado correctamente')
    } catch (error) {
      logger.error({ err: error }, 'Error al cerrar el pool de conexiones')
      throw error
    }
  }
}

/**
 * Sanitiza la consulta SQL para logging (evita mostrar datos sensibles)
 */
const sanitizeSql = (sql) => {
  // Para evitar consultas muy largas en logs
  if (sql.length > 1000) {
    return sql.substring(0, 1000) + '... [truncado]'
  }
  return sql
}

/**
 * Sanitiza los parámetros para logging (evita mostrar datos sensibles)
 */
const sanitizeParams = (params) => {
  if (!params) return null

  // Para arrays, filtramos cada elemento
  if (Array.isArray(params)) {
    return params.map(item => {
      if (typeof item === 'string' && item.length > 100) {
        return item.substring(0, 100) + '... [truncado]'
      }
      return item
    })
  }

  // Para objetos, filtramos campos sensibles
  if (typeof params === 'object') {
    const sanitized = { ...params }
    const sensitiveFields = ['password', 'token', 'secret', 'credit_card', 'card_number']

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '********'
      }
    }

    // Truncar valores largos
    for (const key in sanitized) {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 100) {
        sanitized[key] = sanitized[key].substring(0, 100) + '... [truncado]'
      }
    }

    return sanitized
  }

  return params
}

export {
  closePool, getConnection, initializePool, query, transaction
}
