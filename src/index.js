import serverless from 'serverless-http'
import { EXPRESS_PORT, NODE_ENV } from './config/app.js'
import app from './express.js'

if (NODE_ENV === 'development') {
  app.listen(EXPRESS_PORT, () => {
    console.log(`🚀 Server running on http://localhost:${EXPRESS_PORT}`)
    console.log(`Health check: http://localhost:${EXPRESS_PORT}/api/health`)
  })
} else {
  console.log('AWS Lambda Handler')
}

export const handler = serverless(app)
