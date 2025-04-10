import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import express from 'express'
import helmet from 'helmet'
import { corsMiddleware, errorHandlerMiddleware, executionTime, notFoundMiddleware, responseMiddleware } from 't1-expressjs-core'
import logger from './libs/logger.js'

const app = express()

app.disable('x-powered-by')
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(helmet())
app.use(corsMiddleware)
app.use(executionTime())
app.use(responseMiddleware)

app.get('/test', (req, res) => {
  res.sendResponse(200, 'Execution time test successful', { example: 'data' })
})

// Ruta que genera un error
app.get('/error', (req, res, next) => {
  next(new Error('Something went wrong!'))
})

// Configurar cliente Lambda con AWS SDK v3
const lambdaClient = new LambdaClient({
  region: 'us-east-1' // Cambia a la región de tu Lambda
})

app.get('/invoke-lambda', async (req, res) => {
  try {
    const apiGatewayEvent = {
      resource: '/127000128/abandoned',
      path: '/127000128/abandoned',
      httpMethod: 'GET',
      headers: req.headers, // Pasamos los headers de Express
      queryStringParameters: { interval: '30days' },
      pathParameters: { proxy: '/127000128/abandoned' },
      requestContext: {
        authorizer: {
          sub: '4f3d39aa-4c8e-4c9b-a080-b3ac6679aa6d',
          azp: 'client_t1_test',
          scope: 'openid email profile',
          iss: 'https://keycloack.dev.plataformat1.com/realms/platform-t1',
          principalId: '4f3d39aa-4c8e-4c9b-a080-b3ac6679aa6d',
          integrationLatency: 1461,
          email: 'test@plataformat1.com',
        },
        identity: {
          sourceIp: req.ip || '127.0.0.1'
        }
      },
      body: null, // Para GET no se envía body
      isBase64Encoded: false
    }
    const command = new InvokeCommand({
      FunctionName: 't1-quarkus-abandoned', // Cambia por el nombre real de tu Lambda
      InvocationType: 'RequestResponse', // "Event" si no necesitas esperar respuesta
      Payload: Buffer.from(JSON.stringify(apiGatewayEvent))
    })

    const response = await lambdaClient.send(command)
    const responseBody = JSON.parse(Buffer.from(response.Payload).toString())

    res.json({
      success: true,
      data: responseBody
    })
  } catch (error) {
    console.error('Error al invocar la Lambda:', error)
    res.status(500).json({ success: false, message: 'Error al invocar la Lambda' })
  }
})

app.get('/logger', (req, res) => {
  logger.info('Probando el logger')
  logger.info('Este es un mensaje de nivel info')
  logger.debug('Este es un mensaje de nivel debug con datos', {
    user: 'test-user',
    action: 'test-logger'
  })
  logger.warn('Este es un mensaje de advertencia')
  logger.error('Este es un mensaje de error simulado')

  // Crear un logger contextual
  const orderLogger = logger.child({ context: 'orders', orderId: '12345' })
  orderLogger.info('Procesando orden')

  return res.json({
    message: 'Logger probado exitosamente',
    logLevels: ['info', 'debug', 'warn', 'error'],
    timestamp: new Date().toISOString()
  })
})

app.use(notFoundMiddleware)
app.use(errorHandlerMiddleware)

export default app
