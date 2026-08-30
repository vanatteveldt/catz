import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { router } from './routes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.join(__dirname, '../../client/dist')

const app = express()
app.use(express.json())
app.use('/api', router)

app.use(express.static(clientDist))
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})

const PORT = Number(process.env.PORT ?? 3009)
app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`)
})
