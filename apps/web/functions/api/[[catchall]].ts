import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import type { Bindings } from './_lib/types'
import chat from './_routes/chat'
import analyze from './_routes/analyze'
import price from './_routes/price'
import images from './_routes/images'
import estimates from './_routes/estimates'
import movers from './_routes/movers'
import quoteRequests from './_routes/quote-requests'
import admin from './_routes/admin'

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

app.route('/chat', chat)
app.route('/analyze', analyze)
app.route('/price', price)
app.route('/images', images)
app.route('/estimates', estimates)
app.route('/movers', movers)
app.route('/quote-requests', quoteRequests)
app.route('/admin', admin)

export const onRequest = handle(app)
