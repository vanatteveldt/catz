import express from 'express'
import { router } from './routes.js'

const app = express()
app.use(express.json())
app.use('/api', router)

const PORT = Number(process.env.PORT ?? 3009)
app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`)
})
