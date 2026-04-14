// app.js (PURE JS - no TS syntax)
import pinataSDK from '@pinata/sdk'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import multer from 'multer'
import fs from 'fs'

// Load local .env for dev. In Vercel, env vars come from platform.
dotenv.config()

const app = express()

// --- DEBUG: log every request (shows up in Vercel logs)
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} origin=${req.headers.origin || 'none'}`)
  next()
})

/**
 * CORS
 * Optional: set ALLOWED_ORIGINS in Vercel env as comma-separated list
 * Example:
 *   ALLOWED_ORIGINS=https://tokenize-rwa-template.vercel.app,http://localhost:5173
 */
const explicitAllowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function isAllowedOrigin(origin) {
  if (explicitAllowed.includes('*')) return true
  if (explicitAllowed.includes(origin)) return true
  if (origin === 'http://localhost:5173') return true

  try {
    const host = new URL(origin).hostname
    return (
      host.endsWith('.vercel.app') ||
      host.endsWith('.app.github.dev')
    )
  } catch {
    return false
  }
}

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (isAllowedOrigin(origin)) return cb(null, true)
    return cb(new Error(`CORS blocked for origin: ${origin}`))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 204,
}

// Apply CORS to all routes
app.use(cors(corsOptions))

app.options('*', cors(corsOptions))

app.use(express.json())

const hasJwt = Boolean(process.env.PINATA_JWT && process.env.PINATA_JWT.trim())
const hasApiKeys = Boolean(process.env.PINATA_API_KEY && process.env.PINATA_API_SECRET)

const pinataWithJwt = hasJwt ? new pinataSDK({ pinataJWTKey: process.env.PINATA_JWT }) : null
const pinataWithApiKeys = hasApiKeys
  ? new pinataSDK(process.env.PINATA_API_KEY || '', process.env.PINATA_API_SECRET || '')
  : null

function getPinataErrorMessage(error) {
  const responseData = error?.response?.data

  // Pinata often returns structured reasons/details under response.data
  if (typeof responseData === 'string' && responseData.trim()) return responseData

  if (responseData && typeof responseData === 'object') {
    const reason = typeof responseData.reason === 'string' ? responseData.reason : ''
    const details = typeof responseData.details === 'string' ? responseData.details : ''
    const message =
      typeof responseData.error === 'string'
        ? responseData.error
        : typeof responseData.message === 'string'
        ? responseData.message
        : ''

    if (reason || details || message) {
      return [message, reason, details].filter(Boolean).join(' | ')
    }
  }

  if (typeof error?.message === 'string' && error.message.trim()) return error.message
  return 'Failed to pin to IPFS.'
}

function isScopeError(error) {
  const msg = getPinataErrorMessage(error).toUpperCase()
  return msg.includes('NO_SCOPES_FOUND') || msg.includes('SCOPE') || msg.includes('FORBIDDEN')
}

async function pinWithFallback(file, metaName, metadata) {
  const clients = [
    { client: pinataWithJwt, label: 'PINATA_JWT' },
    { client: pinataWithApiKeys, label: 'PINATA_API_KEY/PINATA_API_SECRET' },
  ].filter((entry) => Boolean(entry.client))

  if (clients.length === 0) {
    throw new Error('Pinata credentials missing. Set PINATA_JWT or PINATA_API_KEY + PINATA_API_SECRET.')
  }

  let lastError = null

  for (const entry of clients) {
    try {
      const stream = fs.createReadStream(file.path)
      const imageResult = await entry.client.pinFileToIPFS(stream, {
        pinataMetadata: { name: file.originalname || `${metaName} Image` },
      })

      const imageUrl = `ipfs://${imageResult.IpfsHash}`
      const jsonResult = await entry.client.pinJSONToIPFS(
        {
          ...metadata,
          image: imageUrl,
        },
        {
          pinataMetadata: { name: `${metaName} Metadata` },
        },
      )

      return {
        metadataUrl: `ipfs://${jsonResult.IpfsHash}`,
        usedCredential: entry.label,
      }
    } catch (error) {
      lastError = error
      const reason = getPinataErrorMessage(error)
      console.error(`Pinata pin failed with ${entry.label}:`, reason)

      // Continue only for credential/scope-related failures.
      if (!isScopeError(error)) break
    }
  }

  throw lastError || new Error('Failed to pin to IPFS.')
}

// Optional: test credentials at cold start
;(async () => {
  if (pinataWithJwt) {
    try {
      const auth = await pinataWithJwt.testAuthentication?.()
      console.log('Pinata auth OK via PINATA_JWT:', auth || 'ok')
    } catch (e) {
      console.error('Pinata authentication FAILED via PINATA_JWT.', getPinataErrorMessage(e))
    }
  }

  if (pinataWithApiKeys) {
    try {
      const auth = await pinataWithApiKeys.testAuthentication?.()
      console.log('Pinata auth OK via API keys:', auth || 'ok')
    } catch (e) {
      console.error('Pinata authentication FAILED via API keys.', getPinataErrorMessage(e))
    }
  }
})()

// Uploads
const upload = multer({
  dest: '/tmp/', // Save to tmp dir so fs.createReadStream works correctly for Pinata
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
})

app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.status(200).json({ ok: true, ts: Date.now() })
})

// DEBUG ROUTE
app.get('/api/debug', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Reached Express',
    url: req.url,
    origin: req.headers.origin || null,
  })
})

function safeTrim(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function safeJsonParse(v, fallback) {
  try {
    if (typeof v !== 'string' || !v.trim()) return fallback
    return JSON.parse(v)
  } catch {
    return fallback
  }
}

app.post('/api/pin-image', upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'No file uploaded' })

    const metaName = safeTrim(req.body?.metaName) || 'NFT Example'
    const metaDescription = safeTrim(req.body?.metaDescription) || 'Pinned via TokenizeRWA template'
    const properties = safeJsonParse(req.body?.properties, {})

    const metadata = {
      name: metaName,
      description: metaDescription,
      properties,
    }

    const result = await pinWithFallback(file, metaName, metadata)

    // Clean up temporary file asynchronously
    fs.unlink(file.path, () => {})

    return res.status(200).json({ metadataUrl: result.metadataUrl })
  } catch (error) {
    // Ensure temp upload is cleaned even on failures.
    if (req.file?.path) fs.unlink(req.file.path, () => {})

    const msg = getPinataErrorMessage(error)
    console.error('Pinata upload error:', msg)
    return res.status(500).json({
      error: msg,
      hint:
        'Verify Pinata credentials and scopes. Required: file pin + JSON pin permissions for the credential used by backend.',
    })
  }
})

// Catch-all 404 (so we KNOW Express is being hit)
app.use((req, res) => {
  console.log(`[MISS] ${req.method} ${req.url}`)
  res.status(404).json({ error: 'NOT_FOUND_IN_EXPRESS', method: req.method, url: req.url })
})

export default app
