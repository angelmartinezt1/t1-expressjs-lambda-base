// src/libs/logger.js
import pino from 'pino'

// Configuración del logger adaptada para entornos serverless
const loggerOptions = {
  // Configuración base para todos los entornos
  base: {
    service: process.env.SERVICE_NAME || 'service',
    env: process.env.NODE_ENV || 'development',
  },
  // Nivel de log basado en variables de entorno
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // Timestamp en formato ISO para mejor correlación con CloudWatch
  timestamp: pino.stdTimeFunctions.isoTime,
  // Configuración específica según entorno
  ...(process.env.NODE_ENV === 'development'
    ? {
        // En desarrollo: salida más legible para humanos
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          }
        }
      }
    : {
        // En producción: JSON puro para CloudWatch
        formatters: {
          level: (label) => {
            return { level: label }
          },
        }
      }
  ),
  // Capturar ID de solicitud de Lambda si está disponible
  mixin: () => {
    const mixinData = {}
    // Capturar el ID de la solicitud de AWS Lambda si está disponible
    if (process.env.AWS_LAMBDA_REQUEST_ID) {
      mixinData.awsRequestId = process.env.AWS_LAMBDA_REQUEST_ID
    }
    return mixinData
  }
}

// Crear la instancia de logger
const logger = pino(loggerOptions)

// Logs específicos para solicitudes HTTP
const httpLogger = {
  request: (req) => {
    if (process.env.LOG_HTTP_REQUESTS !== 'true') return

    // Datos básicos de la solicitud
    const logData = {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
      ip: req.ip || req.connection?.remoteAddress,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-request-id': req.headers['x-request-id'],
      }
    }

    // Evitar registrar datos sensibles en el cuerpo
    if (process.env.LOG_REQUEST_BODY === 'true' && req.body) {
      // No mostrar campos sensibles
      const { password, token, accessToken, refreshToken, ...safeBody } = req.body
      logData.body = safeBody
    }

    logger.debug({ context: 'http', ...logData }, 'Incoming request')
  },

  response: (req, res, responseTime) => {
    if (process.env.LOG_HTTP_RESPONSES !== 'true') return

    logger.debug({
      context: 'http',
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`
    }, 'Outgoing response')
  },

  error: (err, req) => {
    logger.error({
      context: 'http',
      error: {
        message: err.message,
        stack: err.stack,
        code: err.code,
        name: err.name
      },
      method: req.method,
      url: req.url,
      params: req.params
    }, 'HTTP Error')
  }
}

// Logger específico para la base de datos
const dbLogger = logger.child({ context: 'database' })

// Crear un child logger con contexto
const createContextLogger = (context, data = {}) => {
  return logger.child({ context, ...data })
}

export default logger
export { createContextLogger, dbLogger, httpLogger }
