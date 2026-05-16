import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { verifyAdmin } from '../../../lib/verifyAdmin'
import 'dotenv/config'

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const info = await verifyAdmin(req.headers.authorization)
    return res.status(200).json(info)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
}
