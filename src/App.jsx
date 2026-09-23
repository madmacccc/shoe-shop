import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { BrowserMultiFormatReader } from '@zxing/browser'

import ProtectedRoute from './components/ProtectedRoute.jsx'
import { useAuth } from './contexts/AuthContext.jsx'
import { createDefaultStorageData, getRemoteData, saveRemoteData, buildPublicProduct, syncPublicProducts } from './lib/storage.js'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/products', label: 'Products' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/billing', label: 'Billing' },
  { to: '/sales', label: 'Sales' },
  { to: '/qr-codes', label: 'QR Codes' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
]

const themeClasses = {
  classic: {
    shell: 'bg-slate-100 text-slate-800',
    sidebar: 'bg-slate-950 text-slate-100',
    header: 'border-slate-200 bg-white/80 text-slate-900',
    panel: 'border-slate-200 bg-white text-slate-900',
    muted: 'text-slate-500',
  },
  pleasant: {
    shell: 'bg-emerald-50 text-slate-800',
    sidebar: 'bg-gradient-to-b from-emerald-900 via-emerald-800 to-teal-900 text-white',
    header: 'border-emerald-200 bg-white/85 text-slate-900 shadow-sm',
    panel: 'border-emerald-200 bg-white text-slate-900',
    muted: 'text-emerald-700',
  },
  royal: {
    shell: 'bg-violet-50 text-slate-800',
    sidebar: 'bg-gradient-to-b from-violet-950 via-violet-900 to-indigo-950 text-violet-100',
    header: 'border-violet-200 bg-white/85 text-slate-900 shadow-sm',
    panel: 'border-violet-200 bg-white text-slate-900',
    muted: 'text-violet-700',
  },
  dark: {
    shell: 'bg-slate-950 text-slate-100',
    sidebar: 'bg-slate-900 text-slate-100',
    header: 'border-slate-700 bg-slate-900/90 text-slate-100',
    panel: 'border-slate-700 bg-slate-900 text-slate-50',
    muted: 'text-slate-400',
  },
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0))
}

function generateUniqueSku(products = [], currentId = null) {
  const max = products
    .filter((product) => product.id !== currentId && product.sku)
    .reduce((largest, product) => {
      const match = String(product.sku).match(/(\d+)/)
      return Math.max(largest, match ? Number(match[1]) : 0)
    }, 0)

  return `SKU-${String(max + 1).padStart(5, '0')}`
}

function generateUniqueBarcode(products = [], currentId = null) {
  const used = new Set(
    products
      .filter((product) => product.id !== currentId && product.barcode)
      .map((product) => String(product.barcode)),
  )

  let candidate = String(Date.now()).slice(-12)
  let counter = 1

  while (used.has(candidate)) {
    candidate = String(Number(String(Date.now()).slice(-10)) + counter).padStart(12, '0')
    counter += 1
  }

  return candidate
}

function generateInvoiceNumber(sales = [], prefix = 'INV') {
  const highest = sales.reduce((max, sale) => {
    const match = String(sale.invoiceNo || '').match(/(\d+)/)
    return Math.max(max, match ? Number(match[1]) : 0)
  }, 0)

  return `${prefix}-${String(highest + 1).padStart(5, '0')}`
}

function generateStockSerials(stockValue = 0) {
  const count = Number(stockValue || 0)
  if (!Number.isFinite(count) || count <= 0) return []
  return Array.from({ length: count }, (_, index) => index + 1)
}

function generateUnitId(existingUnits = []) {
  const used = new Set((existingUnits || []).map((unit) => String(unit.id || '')))
  let candidate = `UNIT-${String(Date.now()).slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  let counter = 1

  while (used.has(candidate)) {
    candidate = `UNIT-${String(Date.now()).slice(-8)}-${counter.toString().padStart(4, '0')}`
    counter += 1
  }

  return candidate
}

function generateUnitQrCode(existingUnits = []) {
  const used = new Set((existingUnits || []).map((unit) => String(unit.qrCode || '')))
  let candidate = `shoe-shop://unit/${String(Date.now()).slice(-10)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  let counter = 1

  while (used.has(candidate)) {
    candidate = `shoe-shop://unit/${String(Date.now()).slice(-10)}-${counter.toString().padStart(4, '0')}`
    counter += 1
  }

  return candidate
}

function generateUnitBarcode(existingUnits = []) {
  const used = new Set((existingUnits || []).map((unit) => String(unit.barcode || '')))
  let candidate = `B${String(Date.now()).slice(-10)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
  let counter = 1

  while (used.has(candidate)) {
    candidate = `B${String(Date.now()).slice(-10)}${counter.toString().padStart(4, '0')}`
    counter += 1
  }

  return candidate
}

function generateUnitsForProduct(productId, stockCount = 0, existingUnits = []) {
  const nextUnits = [...(Array.isArray(existingUnits) ? existingUnits : [])]
  const required = Number(stockCount || 0)

  while (nextUnits.length < required) {
    nextUnits.push({
      id: generateUnitId(nextUnits),
      productId,
      qrCode: generateUnitQrCode(nextUnits),
      barcode: generateUnitBarcode(nextUnits),
      status: 'available',
      createdAt: new Date().toISOString(),
      soldAt: null,
      saleId: null,
    })
  }

  return nextUnits.slice(0, required)
}

function buildReceiptDetails({ shopName, invoiceNo, paymentMethod, cart, subtotal, gstNumber }) {
  const createdAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

  return {
    shopName: shopName || 'Shoe Shop',
    invoiceNo: invoiceNo || 'INV-00001',
    paymentMethod,
    createdAt,
    gstNumber: gstNumber || 'GST: Not provided',
    items: cart.map((item) => ({
      name: item.name,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      total: Number(item.price || 0) * Number(item.qty || 0),
    })),
    subtotal: Number(subtotal || 0),
  }
}

function buildQrPayload(product, unit, color = 'default', size = 'default') {
  const productName = String(product?.name || 'Shoe').trim() || 'Shoe'
  const selectedColor = String(color || unit?.color || product?.variants?.[0]?.color || 'default').trim() || 'default'
  const selectedSize = String(size || unit?.size || product?.variants?.[0]?.size || 'default').trim() || 'default'
  return `shoe:${productName}|color:${selectedColor}|size:${selectedSize}|barcode:${unit?.barcode || unit?.id || product?.id || 'unknown'}`
}

function buildReceiptHtml(receipt) {
  const rows = receipt.items
    .map(
      (item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.qty}</td>
          <td><span class="money">₹${item.price.toFixed(2)}</span></td>
          <td><span class="money">₹${item.total.toFixed(2)}</span></td>
        </tr>
      `,
    )
    .join('')

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${receipt.shopName} Invoice</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0; padding: 0; background: #fff; color: #0f172a;
            font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5;
          }
          body { display: flex; justify-content: center; }
          .receipt { width: 100%; max-width: 190mm; padding: 10mm 12mm 8mm; }
          .header { text-align: center; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; margin-bottom: 12px; }
          h1 { margin: 0; font-size: 26px; font-weight: 700; }
          .meta { margin-top: 8px; font-size: 11px; color: #475569; line-height: 1.6; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 8px; font-size: 12px; }
          th, td { padding: 5px 4px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
          th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; }
          th:nth-child(2), td:nth-child(2), th:nth-child(3), td:nth-child(3), th:nth-child(4), td:nth-child(4) { text-align: right; }
          .money { display: inline-block; min-width: 62px; font-variant-numeric: tabular-nums; }
          .totals { width: 66%; margin-left: auto; margin-top: 18px; border-top: 1px dashed #cbd5e1; padding-top: 10px; font-size: 12px; }
          .totals-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; margin: 7px 0; }
          .grand { margin-top: 8px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 18px; font-weight: 700; }
          .footer { margin-top: 18px; text-align: center; font-size: 11px; color: #475569; }
        </style>
      </head>
      <body>
        <div class="receipt">
          <div class="header">
            <h1>${receipt.shopName}</h1>
            <div class="meta">
              ${receipt.gstNumber}<br />
              Invoice: ${receipt.invoiceNo}<br />
              Date: ${receipt.createdAt}<br />
              Payment: ${receipt.paymentMethod}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <div class="totals">
            <div class="totals-row"><span>Subtotal</span><span>₹${receipt.subtotal.toFixed(2)}</span></div>
            <div class="totals-row"><span>GST</span><span>₹0.00</span></div>
            <div class="totals-row grand"><span>Total</span><span>₹${receipt.subtotal.toFixed(2)}</span></div>
          </div>

          <div class="footer">Thank you for shopping with us.</div>
        </div>
      </body>
    </html>
  `
}

function SectionHeader({ eyebrow, title, description }) {
  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold text-slate-900">{title}</h2>
      {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
    </div>
  )
}

function EmptyState({ title, message, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

function AdminLayout({ children, title, subtitle, theme = 'classic' }) {
  const palette = themeClasses[theme] || themeClasses.classic
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const mobileQuickActions = NAV_ITEMS.filter((item) => item.to === '/billing' || item.to === '/qr-codes')
  const mobileActionGradient = {
    classic: 'from-slate-900 via-slate-800 to-slate-950',
    pleasant: 'from-emerald-900 via-emerald-800 to-teal-900',
    royal: 'from-violet-900 via-indigo-900 to-violet-950',
    dark: 'from-slate-900 via-slate-800 to-slate-950',
  }[theme] || 'from-violet-900 via-indigo-900 to-violet-950'

  if (isMobile) {
    return (
      <div className={`min-h-screen ${palette.shell}`}>
        <main className="min-h-screen">
          <header className={`sticky top-0 z-10 border-b backdrop-blur-sm ${palette.header}`}>
            <div className="flex items-center justify-between px-4 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-600">Shoe Shop</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">{title}</h2>
              </div>
              <div className={`text-xs font-medium ${palette.muted}`}>{subtitle}</div>
            </div>
          </header>

          <div className="px-4 pb-6 pt-4">
            <div className={`mb-4 rounded-3xl border border-white/40 bg-gradient-to-br ${mobileActionGradient} p-3 shadow-lg`}>
              <div className="grid gap-3">
                {mobileQuickActions.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex min-h-[92px] items-center justify-between rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                        isActive
                          ? 'border-white/30 bg-white/15 text-white shadow-lg'
                          : 'border-white/10 bg-white/5 text-violet-50 hover:bg-white/10'
                      }`
                    }
                  >
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200">Quick access</div>
                      <div className="mt-2 text-xl font-bold">{item.label === 'Billing' ? 'Billing' : 'QR Scanner'}</div>
                    </div>
                    <div className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-violet-100">
                      {item.label === 'Billing' ? 'Fast' : 'Scan'}
                    </div>
                  </NavLink>
                ))}
              </div>
            </div>

            <div className="space-y-4">{children}</div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={`min-h-screen ${palette.shell}`}>
      <aside className={`fixed inset-y-0 left-0 z-20 w-72 border-r ${palette.sidebar}`}>
        <div className="flex h-20 items-center border-b border-slate-800 px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-400">Shoe Shop</p>
            <h1 className="mt-1 text-xl font-bold">Control Center</h1>
          </div>
        </div>

        <nav className="space-y-1 p-4">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-xl px-4 py-3 text-sm font-medium transition ${
                  isActive ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 w-full border-t border-slate-800 p-4 text-xs text-slate-400">
          <div>Developed by : Er.R.Rakeshwar </div>
        </div>
      </aside>

      <main className="ml-72 min-h-screen">
        <header className={`border-b backdrop-blur-sm ${palette.header}`}>
          <div className="flex items-center justify-between px-8 py-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-600">Management</p>
              <h2 className="mt-1 text-2xl font-bold">{title}</h2>
            </div>
            <div className={`text-sm ${palette.muted}`}>{subtitle}</div>
          </div>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}

function DashboardPage({ data }) {
  const salesTotal = data.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const soldUnits = data.sales.reduce((sum, sale) => sum + sale.lineItems.reduce((inner, item) => inner + Number(item.qty || 0), 0), 0)
  const activeProducts = data.products.filter((product) => product.status === 'active').length
  const lowStock = data.products.filter((product) => product.variants.some((variant) => Number(variant.stock || 0) <= (data.settings?.lowStockThreshold || 5))).length
  const stockUnits = data.products.reduce((sum, product) => sum + product.variants.reduce((inner, variant) => inner + Number(variant.stock || 0), 0), 0)
  const avgOrder = data.sales.length ? salesTotal / data.sales.length : 0

  const topProduct = useMemo(() => {
    return data.products.reduce((best, product) => {
      const sold = product.variants.reduce((sum, variant) => sum + Number(variant.sold || 0), 0)
      if (!best || sold > best.sold) return { name: product.name, sold }
      return best
    }, null)
  }, [data.products])

  const metricCards = [
    { label: 'Revenue', value: formatMoney(salesTotal), tone: 'emerald' },
    { label: 'Sales', value: String(data.sales.length), tone: 'blue' },
    { label: 'Units in Stock', value: String(stockUnits), tone: 'amber' },
    { label: 'Low Stock', value: String(lowStock), tone: 'rose' },
  ]

  return (
    <AdminLayout title="Dashboard" subtitle="Retail overview" theme={data.settings?.theme || 'pleasant'}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{card.label}</p>
            <div className="mt-4 flex items-end justify-between">
              <p className="text-3xl font-bold text-slate-900">{card.value}</p>
              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                card.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : card.tone === 'blue' ? 'bg-blue-100 text-blue-700' : card.tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
              }`}>live</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Active Products</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{activeProducts}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Items Sold</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{soldUnits}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Avg Order Value</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(avgOrder)}</p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Overview" title="Recent sales" description="Latest transactions from the local sales ledger." />
          {data.sales.length === 0 ? (
            <EmptyState title="No recent sales" message="Create a product, add stock, and complete a sale to see activity here." />
          ) : (
            <div className="space-y-3">
              {data.sales.slice(0, 6).map((sale) => (
                <div key={sale.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="font-semibold text-slate-900">{sale.invoiceNo}</p>
                    <p className="text-xs text-slate-500">{sale.paymentMethod}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-900">{formatMoney(sale.total)}</p>
                    <p className="text-xs text-slate-500">{sale.lineItems.length} items</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Insights" title="Performance" description="Quick snapshot of your best-selling item and alerts." />
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <span className="font-semibold">Top product:</span> {topProduct ? `${topProduct.name} (${topProduct.sold} sold)` : 'No product data'}
            </div>
            {lowStock === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No stock alerts at the moment.</div>
            ) : (
              data.products
                .filter((product) => product.variants.some((variant) => Number(variant.stock || 0) <= (data.settings?.lowStockThreshold || 5)))
                .map((product) => (
                  <div key={product.id} className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    {product.name} is running low on stock.
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function ProductsPage({ data, onDeleteProduct }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const filteredProducts = data.products.filter((product) => {
    const query = search.trim().toLowerCase()
    const matchesText = !query || [product.name, product.brand, product.sku, product.barcode].some((value) => String(value || '').toLowerCase().includes(query))
    const matchesStatus = statusFilter === 'all' || product.status === statusFilter
    return matchesText && matchesStatus
  })

  return (
    <AdminLayout title="Products" subtitle="Catalog and pricing" theme={data.settings?.theme || 'pleasant'}>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-slate-500">{data.products.length} products stored locally</div>
        <Link to="/products/add" className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">+ Add product</Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader eyebrow="Catalog" title="Products" description="Keep your stock, prices, and QR tags synced on the local machine." />
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_200px]">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Search by name, brand, SKU, or barcode" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5">
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {filteredProducts.length === 0 ? (
          <EmptyState title="No products yet" message="Add a product to start selling and publishing QR codes." action={<Link to="/products/add" className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Create product</Link>} />
        ) : (
          <div className="space-y-3">
            {filteredProducts.map((product) => (
              <div key={product.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900">{product.name}</p>
                  <p className="text-sm text-slate-500">{product.brand} • {product.sku || 'No SKU'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">{product.status}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">{product.barcode || 'No barcode'}</span>
                  <Link to={`/products/${product.id}/edit`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Edit</Link>
                  <button type="button" onClick={() => onDeleteProduct(product.id)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function ProductEditorPage({ data, onSaveProduct, onUpdateExistingProduct }) {
  const { id } = useParams()
  const existingProduct = data.products.find((product) => product.id === id)

  const [form, setForm] = useState(
    existingProduct || {
      id: '',
      name: '',
      brand: '',
      categoryId: '',
      sku: '',
      barcode: '',
      sellingPrice: '',
      costPrice: '',
      MRP: '',
      discount: '0',
      status: 'active',
      images: [],
      variants: [{ id: 'variant-1', color: '', size: '', stock: '0', sold: '0', serialNumbers: [] }],
      units: [],
    },
  )

  useEffect(() => {
    if (existingProduct) setForm(existingProduct)
  }, [existingProduct])

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const addVariantRow = () => {
    setForm((current) => ({
      ...current,
      variants: [
        ...current.variants,
        { id: `variant-${Date.now()}`, color: '', size: '', stock: '0', sold: '0', serialNumbers: [] },
      ],
    }))
  }

  const updateVariant = (index, field, value) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) => {
        if (variantIndex !== index) return variant
        const nextVariant = { ...variant, [field]: value }
        if (field === 'stock') {
          nextVariant.serialNumbers = generateStockSerials(Number(value || 0))
        }
        return nextVariant
      }),
    }))
  }

  const handleSave = () => {
    const cleaned = {
      ...form,
      sku: form.sku || generateUniqueSku(data.products, existingProduct?.id),
      barcode: form.barcode || generateUniqueBarcode(data.products, existingProduct?.id),
      sellingPrice: Number(form.sellingPrice || 0),
      costPrice: Number(form.costPrice || 0),
      MRP: Number(form.MRP || 0),
      discount: Number(form.discount || 0),
      variants: (form.variants || []).map((variant) => ({
        ...variant,
        stock: Number(variant.stock || 0),
        sold: Number(variant.sold || 0),
        serialNumbers: generateStockSerials(Number(variant.stock || 0)),
      })),
      units: Array.isArray(form.units) && form.units.length
        ? form.units.map((unit) => ({
            ...unit,
            productId: unit.productId || form.id || `product-${Date.now()}`,
            status: unit.status === 'sold' ? 'sold' : 'available',
          }))
        : generateUnitsForProduct(
            existingProduct?.id || `product-${Date.now()}`,
            Number((form.variants || []).reduce((sum, variant) => sum + Number(variant.stock || 0), 0) || 0),
            [],
          ),
    }

    const productPayload = existingProduct ? { ...cleaned, id: existingProduct.id } : { ...cleaned, id: `product-${Date.now()}` }
    const productToStore = {
      ...productPayload,
      units: Array.isArray(productPayload.units) && productPayload.units.length ? productPayload.units : generateUnitsForProduct(productPayload.id, Number((productPayload.variants || []).reduce((sum, variant) => sum + Number(variant.stock || 0), 0) || 0), []),
      variants: (productPayload.variants || []).map((variant, index) => ({
        ...variant,
        id: variant.id || `variant-${index + 1}`,
        stock: Number(variant.stock || 0),
        sold: Number(variant.sold || 0),
        serialNumbers: generateStockSerials(Number(variant.stock || 0)),
      })),
    }

    if (existingProduct) {
      onUpdateExistingProduct(productToStore)
    } else {
      onSaveProduct(productToStore)
    }

    window.location.href = '/products'
  }

  return (
    <AdminLayout title="Product Editor" subtitle="Create or edit catalog items" theme={data.settings?.theme || 'pleasant'}>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader eyebrow="Product setup" title={existingProduct ? 'Edit product' : 'Create product'} description="All product data is saved on this device's storage drive." />

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Name</label>
            <input value={form.name} onChange={(event) => updateField('name', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Air Max Street Runner" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Brand</label>
            <input value={form.brand} onChange={(event) => updateField('brand', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Nike" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Category</label>
            <input value={form.categoryId} onChange={(event) => updateField('categoryId', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="running" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">SKU</label>
            <input value={form.sku || generateUniqueSku(data.products, existingProduct?.id)} onChange={(event) => updateField('sku', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="SKU-00001" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Barcode</label>
            <input value={form.barcode || generateUniqueBarcode(data.products, existingProduct?.id)} onChange={(event) => updateField('barcode', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="8901234567890" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Status</label>
            <select value={form.status} onChange={(event) => updateField('status', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Cost Price</label>
            <input value={form.costPrice} onChange={(event) => updateField('costPrice', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="2500" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Selling Price</label>
            <input value={form.sellingPrice} onChange={(event) => updateField('sellingPrice', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="3999" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">MRP</label>
            <input value={form.MRP} onChange={(event) => updateField('MRP', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="4999" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Discount %</label>
            <input value={form.discount} onChange={(event) => updateField('discount', event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="10" />
          </div>
        </div>

        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Variants</h3>
            <button type="button" onClick={addVariantRow} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">+ Add variant</button>
          </div>

          <div className="space-y-3">
            {(form.variants || []).map((variant, index) => (
              <div key={variant.id || index} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
                <input value={variant.color} onChange={(event) => updateVariant(index, 'color', event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5" placeholder="Color" />
                <input value={variant.size} onChange={(event) => updateVariant(index, 'size', event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5" placeholder="Size" />
                <input type="number" value={variant.stock} onChange={(event) => updateVariant(index, 'stock', event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5" placeholder="Stock" />
                <input type="number" value={variant.sold} onChange={(event) => updateVariant(index, 'sold', event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5" placeholder="Sold" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <Link to="/products" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</Link>
          <button type="button" onClick={handleSave} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Save product</button>
        </div>
      </div>
    </AdminLayout>
  )
}

function InventoryPage({ data, onAdjustInventory }) {
  const [form, setForm] = useState({ variantId: '', type: 'opening', delta: '0', reason: '' })

  const handleSave = () => {
    if (!form.variantId.trim()) return
    onAdjustInventory({
      variantId: form.variantId,
      type: form.type,
      delta: Number(form.delta || 0),
      reason: form.reason || 'Manual update',
    })
    setForm({ variantId: '', type: 'opening', delta: '0', reason: '' })
  }

  return (
    <AdminLayout title="Inventory" subtitle="Stock journal" theme={data.settings?.theme || 'pleasant'}>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Ledger" title="Inventory control" description="Track all local stock changes and stock corrections." />
          {data.inventoryTransactions.length === 0 ? (
            <EmptyState title="No adjustments yet" message="Manual stock adjustments will appear here as they are recorded." />
          ) : (
            <div className="space-y-3">
              {data.inventoryTransactions.slice(0, 12).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-900">{entry.type}</span>
                    <span className="text-slate-500">{entry.variantId}</span>
                  </div>
                  <div className="mt-1 text-slate-600">Δ {entry.delta} • before {entry.beforeStock} • after {entry.afterStock}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Adjustment" title="New entry" description="Add or deduct stock quantity." />
          <div className="space-y-3">
            <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5">
              <option value="opening">Opening stock</option>
              <option value="addition">Addition</option>
              <option value="return">Return</option>
              <option value="damage">Damage</option>
              <option value="adjustment">Adjustment</option>
            </select>
            <input value={form.variantId} onChange={(event) => setForm((current) => ({ ...current, variantId: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Variant ID" />
            <input value={form.delta} onChange={(event) => setForm((current) => ({ ...current, delta: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Delta quantity" />
            <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Reason" />
            <button type="button" onClick={handleSave} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Save adjustment</button>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function BillingPage({ data, onCompleteSale, onReturnProduct, settings }) {
  const [cart, setCart] = useState([])
  const [barcode, setBarcode] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [scanError, setScanError] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const scannerRef = useRef(null)
  const videoRef = useRef(null)

  const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0)
  const itemCount = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0)

  const findProduct = (value) => {
    const stringValue = String(value || '').trim()
    if (!stringValue) return null

    return (
      data.products.find((product) => {
        const unit = (product.units || []).find((item) => item.barcode === stringValue || item.qrCode === stringValue || item.id === stringValue)
        return unit || product.barcode === stringValue || product.sku === stringValue || product.id === stringValue
      }) || null
    )
  }

  const addToCart = () => {
    const value = String(barcode || '').trim()
    if (!value) return

    const product = findProduct(value)
    if (!product) {
      setScanError('Product not found for this barcode, QR code, SKU, or unit ID.')
      return
    }

    const unit = (product.units || []).find((item) => item.barcode === value || item.qrCode === value || item.id === value)
    if (unit && unit.status === 'sold') {
      setScanError('This individual unit has already been sold.')
      return
    }

    setScanError('')
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id)
      if (existing) {
        return current.map((item) => (item.productId === product.id ? { ...item, qty: Number(item.qty || 0) + 1, unitIds: [...(item.unitIds || []), unit?.id || product.id] } : item))
      }

      return [
        ...current,
        {
          id: `${product.id}-default`,
          productId: product.id,
          name: product.name,
          price: Number(product.sellingPrice || 0),
          qty: 1,
          unitIds: unit ? [unit.id] : [],
        },
      ]
    })
    setBarcode('')
  }

  const stopScanner = () => {
    scannerRef.current?.stop?.()
    setIsScanning(false)
  }

  const startScanner = async () => {
    try {
      setScanError('')
      setIsScanning(true)

      const codeReader = new BrowserMultiFormatReader()
      const devices = await BrowserMultiFormatReader.listVideoInputDevices()

      if (!devices.length) {
        setScanError('No camera found on this device.')
        setIsScanning(false)
        return
      }

      scannerRef.current = codeReader
      const result = await codeReader.decodeOnceFromVideoDevice(devices[0].deviceId, videoRef.current)
      const value = result?.getText?.() || ''
      if (value) {
        setBarcode(value)
        const product = findProduct(value)
        if (!product) {
          setScanError('Scanned code does not match a local product.')
        }
      }
      stopScanner()
    } catch (error) {
      setScanError('Unable to scan. Please use manual barcode entry.')
      setIsScanning(false)
    }
  }

  const printInvoice = () => {
    if (!cart.length) return

    const invoiceNo = generateInvoiceNumber(data.sales, settings?.invoicePrefix || 'INV')
    const receipt = buildReceiptDetails({
      shopName: settings?.shopName || 'Shoe Shop',
      invoiceNo,
      paymentMethod,
      cart,
      subtotal,
      gstNumber: settings?.gstNumber || '',
    })

    const popup = window.open('', '_blank', 'width=900,height=1000')
    if (!popup) return
    popup.document.write(buildReceiptHtml(receipt))
    popup.document.close()
    popup.focus()
    setTimeout(() => {
      popup.print()
      popup.close()
    }, 300)
  }

  const shareOnWhatsApp = () => {
    if (!cart.length) return

    const clientNumber = window.prompt('Enter client WhatsApp mobile number with country code (example: 919876543210):', '')
    if (!clientNumber) return

    const normalizedNumber = clientNumber.replace(/\D/g, '')
    if (!normalizedNumber) {
      window.alert('Please enter a valid WhatsApp mobile number.')
      return
    }

    const invoiceNo = generateInvoiceNumber(data.sales, settings?.invoicePrefix || 'INV')
    const receipt = buildReceiptDetails({ shopName: settings?.shopName || 'Shoe Shop', invoiceNo, paymentMethod, cart, subtotal, gstNumber: settings?.gstNumber || '' })
    const lines = receipt.items.map((item) => `${item.name} x${item.qty} - ${formatMoney(item.total)}`)
    const message = `*${receipt.shopName}*\nInvoice: ${receipt.invoiceNo}\nDate: ${receipt.createdAt}\n\n${lines.join('\n')}\n\nSubtotal: ${formatMoney(receipt.subtotal)}\nTotal: ${formatMoney(receipt.subtotal)}\nPayment: ${receipt.paymentMethod}`
    window.open(`https://wa.me/${normalizedNumber}?text=${encodeURIComponent(message)}`, '_blank')
  }

  const handleReturn = () => {
    const value = String(barcode || '').trim()
    if (!value) {
      setScanError('Scan or enter the returned product QR/barcode.')
      return
    }

    const product = data.products.find((item) => {
      const unit = (item.units || []).find((entry) => entry.barcode === value || entry.qrCode === value || entry.id === value)
      return Boolean(unit)
    })

    if (!product) {
      setScanError('Returned item was not found in the stock records.')
      return
    }

    const unit = (product.units || []).find((entry) => entry.barcode === value || entry.qrCode === value || entry.id === value)
    if (!unit) {
      setScanError('Returned item was not found in the stock records.')
      return
    }

    if (unit.status !== 'sold') {
      setScanError('This item is already available. No return is needed.')
      return
    }

    const confirmed = window.confirm(`Return ${product.name} and restore it to stock?`)
    if (!confirmed) return

    onReturnProduct(product.id, unit.id)
    setBarcode('')
    setScanError('')
    window.alert('Product returned successfully and marked as available again.')
  }

  const completeSale = () => {
    if (!cart.length) return
    const invoiceNo = generateInvoiceNumber(data.sales, settings?.invoicePrefix || 'INV')

    const saleLineItems = cart.map((item) => {
      const matchedProduct = data.products.find((product) => product.id === item.productId)
      const availableUnits = (matchedProduct?.units || []).filter((unit) => unit.status === 'available')
      const soldUnits = (item.unitIds?.length ? item.unitIds : availableUnits.slice(0, Number(item.qty || 0)).map((unit) => unit.id)).slice(0, Number(item.qty || 0))

      return {
        productId: item.productId,
        variantId: item.id,
        color: 'default',
        size: 'default',
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        costPrice: 0,
        taxAmount: 0,
        soldUnitIds: soldUnits,
      }
    })

    onCompleteSale({
      invoiceNo,
      paymentMethod,
      lineItems: saleLineItems,
      total: subtotal,
      taxTotal: 0,
    })

    setCart([])
    setBarcode('')
  }

  return (
    <AdminLayout title="Billing" subtitle="Local checkout" theme={settings?.theme || 'pleasant'}>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Checkout" title="Sale panel" description="Search, scan, or manually add products to the bill." />

          <div className="mb-4 flex flex-col gap-3">
            <div className="flex gap-3">
              <input value={barcode} onChange={(event) => setBarcode(event.target.value)} className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Scan or enter barcode, SKU, or product ID" />
              <button type="button" onClick={addToCart} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Add</button>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={startScanner} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700">{isScanning ? 'Scanning...' : 'Scan product'}</button>
              {isScanning ? <button type="button" onClick={stopScanner} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">Stop</button> : null}
            </div>
          </div>

          {isScanning ? (
            <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <video ref={videoRef} className="mx-auto h-56 w-full rounded-xl bg-black object-cover" autoPlay playsInline muted />
            </div>
          ) : null}

          {scanError ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{scanError}</div> : null}

          {cart.length === 0 ? (
            <EmptyState title="Empty cart" message="Scan a product or type a barcode to add an item." />
          ) : (
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <div className="font-semibold text-slate-900">{item.name}</div>
                    <div className="text-sm text-slate-500">Qty: {item.qty}</div>
                  </div>
                  <div className="font-semibold text-slate-900">{formatMoney(Number(item.price || 0) * Number(item.qty || 0))}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Summary" title="Invoice" description="Totals are calculated instantly." />
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex justify-between"><span>Items</span><span>{itemCount}</span></div>
            <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
            <div className="flex justify-between"><span>GST</span><span>₹0.00</span></div>
            <div className="flex justify-between text-base font-semibold text-slate-900"><span>Total</span><span>{formatMoney(subtotal)}</span></div>
          </div>

          <div className="mt-6 space-y-3">
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="wallet">Wallet</option>
            </select>
            <button type="button" onClick={completeSale} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700">Complete sale</button>
            <button type="button" onClick={handleReturn} className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100">Return product</button>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={printInvoice} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700">Print</button>
              <button type="button" onClick={shareOnWhatsApp} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">WhatsApp</button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function SalesPage({ data }) {
  const salesByDate = useMemo(() => {
    const map = new Map()

    for (const sale of data.sales) {
      const dateKey = sale.createdAt ? new Date(sale.createdAt).toLocaleDateString('en-CA') : new Date().toLocaleDateString('en-CA')
      const amount = Number(sale.total || 0)
      const existing = map.get(dateKey) || { dateKey, sales: [], total: 0 }
      existing.sales.push(sale)
      existing.total += amount
      map.set(dateKey, existing)
    }

    return [...map.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }, [data.sales])

  return (
    <AdminLayout title="Sales" subtitle="Invoice history" theme={data.settings?.theme || 'pleasant'}>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeader eyebrow="Invoices" title="Sales history" description="Date-wise sale activity and invoice history." />
          <button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">Print</button>
        </div>

        {salesByDate.length === 0 ? (
          <EmptyState title="No sales recorded" message="Completed sales will appear here automatically." />
        ) : (
          <div className="space-y-4">
            {salesByDate.map((day) => (
              <div key={day.dateKey} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{new Date(day.dateKey).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <span className="text-sm font-semibold text-slate-900">{formatMoney(day.total)}</span>
                </div>

                <div className="space-y-2">
                  {day.sales.map((sale) => (
                    <div key={sale.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{sale.invoiceNo}</span>
                        <span className="text-sm text-slate-500">{sale.paymentMethod}</span>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">Items: {sale.lineItems.length} • Total: {formatMoney(sale.total)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function QrCodesPage({ data }) {
  const [selected, setSelected] = useState('')
  const [image, setImage] = useState('')
  const [unitRows, setUnitRows] = useState([])

  useEffect(() => {
    const product = data.products.find((item) => item.id === selected)
    if (!product) {
      setUnitRows([])
      setImage('')
      return
    }

    const rows = (product.units || []).map((unit) => ({
      ...unit,
      qrImage: '',
    }))

    Promise.all(
      rows.map(async (unit) => {
        const qrContent = buildQrPayload(product, unit, product.variants?.[0]?.color || 'default', product.variants?.[0]?.size || 'default')
        const qrUrl = await QRCode.toDataURL(qrContent || `${window.location.origin}/product/${product.id}`, { width: 220, margin: 1 })
        return { ...unit, qrImage: qrUrl }
      }),
    )
      .then((resolved) => setUnitRows(resolved))
      .catch(() => setUnitRows([]))

    if (product.units?.length) {
      const firstUnit = product.units[0]
      const firstQrPayload = buildQrPayload(product, firstUnit, product.variants?.[0]?.color || 'default', product.variants?.[0]?.size || 'default')
      QRCode.toDataURL(firstQrPayload || `${window.location.origin}/product/${product.id}`, { width: 280, margin: 1 })
        .then((url) => setImage(url))
        .catch(() => setImage(''))
    } else {
      setImage('')
    }
  }, [selected, data.products])

  const printQrBatch = async () => {
    const product = data.products.find((item) => item.id === selected)
    if (!product || !product.units?.length) return

    const unitData = await Promise.all(
      product.units.map(async (unit) => ({
        ...unit,
        qrImage: await QRCode.toDataURL(buildQrPayload(product, unit, product.variants?.[0]?.color || 'default', product.variants?.[0]?.size || 'default'), { width: 220, margin: 1 }).catch(() => ''),
      })),
    )

    const rows = unitData
      .map((unit) => `
        <div style="width: 170px; height: 225px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 12px; display: inline-block; margin: 8px; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; margin-bottom: 5px;">${product.name}</div>
          <div style="font-size: 10px; color: #475569; margin-bottom: 5px;">${product.variants?.[0]?.color || 'Color'} • ${product.variants?.[0]?.size || 'Size'}</div>
          <img src="${unit.qrImage || ''}" style="width: 110px; height: 110px; display: block; margin: 0 auto;" />
          <div style="font-size: 10px; margin-top: 6px;">ID: ${unit.id}</div>
          <div style="font-size: 10px;">Barcode: ${unit.barcode}</div>
        </div>
      `)
      .join('')

    const popup = window.open('', '_blank', 'width=900,height=1000')
    if (!popup) return
    popup.document.write(`<!doctype html><html><head><title>${product.name} QR Batch</title><style>body{font-family:Arial,sans-serif;padding:20px} .grid{display:flex;flex-wrap:wrap;gap:10px}</style></head><body><div class="grid">${rows}</div></body></html>`)
    popup.document.close()
    popup.focus()
    setTimeout(() => popup.print(), 250)
  }

  const downloadQrBatch = () => {
    const product = data.products.find((item) => item.id === selected)
    if (!product || !product.units?.length) return

    const payload = product.units.map((unit) => ({
      productId: unit.productId,
      unitId: unit.id,
      qrCode: unit.qrCode,
      barcode: unit.barcode,
      status: unit.status,
    }))

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${product.name.toLowerCase().replace(/\s+/g, '-')}-units.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AdminLayout title="QR Codes" subtitle="Unit-based stock labels" theme={data.settings?.theme || 'pleasant'}>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Generate" title="Label builder" description="Pick a product to generate a label set for each individual unit." />
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5">
            <option value="">Select product</option>
            {data.products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>

          {selected ? (
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={printQrBatch} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700">Print all QR codes</button>
              <button type="button" onClick={downloadQrBatch} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Download data</button>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Preview" title="Printable QR" description="Each generated unit has a unique QR and barcode reference." />
          {image ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center">
              <img src={image} alt="Generated QR code" className="mx-auto h-64 w-64 rounded-xl bg-white p-3" />
            </div>
          ) : (
            <EmptyState title="No QR generated" message="Choose a product to generate a unit label set." />
          )}

          {unitRows.length ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {unitRows.slice(0, 6).map((unit) => (
                <div key={unit.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <img src={unit.qrImage} alt={unit.id} className="mx-auto h-20 w-20 rounded-lg bg-white p-2" />
                  <div className="mt-2 text-xs font-medium text-slate-600">ID: {unit.id}</div>
                  <div className="text-xs text-slate-500">Barcode: {unit.barcode}</div>
                  <div className="text-xs text-slate-500">Status: {unit.status}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  )
}

function ReportsPage({ data }) {
  const totalRevenue = data.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const totalCost = data.sales.reduce((sum, sale) => sum + sale.lineItems.reduce((inner, item) => inner + Number(item.costPrice || 0) * Number(item.qty || 0), 0), 0)
  const totalProfit = totalRevenue - totalCost

  const salesByDate = useMemo(() => {
    const map = new Map()

    for (const sale of data.sales) {
      const dateKey = sale.createdAt ? new Date(sale.createdAt).toLocaleDateString('en-CA') : new Date().toLocaleDateString('en-CA')
      const existing = map.get(dateKey) || { dateKey, sales: [], total: 0 }
      existing.sales.push(sale)
      existing.total += Number(sale.total || 0)
      map.set(dateKey, existing)
    }

    return [...map.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }, [data.sales])

  return (
    <AdminLayout title="Reports" subtitle="Performance overview" theme={data.settings?.theme || 'pleasant'}>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <SectionHeader eyebrow="Analytics" title="Revenue and profit" description="Summary built from local sales stored on this workstation." />
          <button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">Print report</button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm text-slate-500">Total revenue</p><p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(totalRevenue)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm text-slate-500">Net profit</p><p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(totalProfit)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm text-slate-500">Products</p><p className="mt-2 text-2xl font-bold text-slate-900">{data.products.length}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm text-slate-500">Sales</p><p className="mt-2 text-2xl font-bold text-slate-900">{data.sales.length}</p></div>
        </div>

        <div className="mt-8">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">Date-wise sales</h3>
          <div className="space-y-3">
            {salesByDate.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No sales data for the selected period.</div>
            ) : (
              salesByDate.map((day) => (
                <div key={day.dateKey} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{new Date(day.dateKey).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    <span className="text-sm text-slate-600">{formatMoney(day.total)}</span>
                  </div>
                  <div className="text-sm text-slate-600">Invoices: {day.sales.length}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function SettingsPage({ data, onSaveSettings, onExportBackup, onImportBackup, onResetFullApp }) {
  const [settings, setSettings] = useState(data.settings)

  useEffect(() => {
    setSettings(data.settings)
  }, [data.settings])

  const saveSettings = () => onSaveSettings(settings)

  return (
    <AdminLayout title="Settings" subtitle="Store preferences" theme={data.settings?.theme || 'pleasant'}>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Business" title="Shop setup" description="Store details are saved locally on disk." />
          <div className="space-y-3">
            <input value={settings.shopName} onChange={(event) => setSettings((current) => ({ ...current, shopName: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Shop name" />
            <input value={settings.gstNumber} onChange={(event) => setSettings((current) => ({ ...current, gstNumber: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="GST number" />
            <input value={settings.currency} onChange={(event) => setSettings((current) => ({ ...current, currency: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Currency" />
            <input value={settings.invoicePrefix} onChange={(event) => setSettings((current) => ({ ...current, invoicePrefix: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Invoice prefix" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader eyebrow="Appearance" title="Theme and alerts" description="Customize the dashboard look and low-stock threshold." />
          <div className="space-y-3">
            <select value={settings.theme || 'pleasant'} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5">
              <option value="pleasant">Pleasant</option>
              <option value="royal">Royal</option>
              <option value="classic">Classic</option>
              <option value="dark">Dark</option>
            </select>
            <input type="color" value={settings.accentColor || '#10b981'} onChange={(event) => setSettings((current) => ({ ...current, accentColor: event.target.value }))} className="h-12 w-full cursor-pointer rounded-xl border border-slate-300 bg-slate-50 p-1" />
            <input value={settings.lowStockThreshold ?? 5} onChange={(event) => setSettings((current) => ({ ...current, lowStockThreshold: Number(event.target.value || 0) }))} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5" placeholder="Low stock threshold" />
            <button type="button" onClick={saveSettings} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Save settings</button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <SectionHeader eyebrow="Backup" title="Data backup" description="Export your local data as a JSON file or restore it anytime." />
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={onExportBackup} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Export backup</button>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <input type="file" accept="application/json" className="hidden" onChange={onImportBackup} />
              Import backup
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm xl:col-span-2">
          <SectionHeader eyebrow="Danger" title="Reset application" description="This removes all local products, sales, inventory, and settings from the app." />
          <button type="button" onClick={onResetFullApp} className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-500">Reset full web app</button>
        </div>
      </div>
    </AdminLayout>
  )
}

function PublicProductPage({ data }) {
  const { productId } = useParams()
  const product = data.products.find((item) => item.id === productId) || data.publicProducts.find((item) => item.id === productId)
  const [selectedColor, setSelectedColor] = useState('')
  const [selectedSize, setSelectedSize] = useState('')

  useEffect(() => {
    if (product) {
      setSelectedColor(product.colors?.[0] || '')
      setSelectedSize(product.sizes?.[0] || '')
    }
  }, [product])

  if (!product || product.status !== 'active') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-500">Unavailable</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">This product is not available</h1>
          <p className="mt-3 text-sm text-slate-600">The public product page only shows active stock items.</p>
        </div>
      </div>
    )
  }

  const availabilityKey = `${selectedColor}::${selectedSize}`
  const isAvailable = selectedColor && selectedSize ? Boolean(product.availability?.[availabilityKey]) : false

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="h-72 bg-gradient-to-br from-slate-200 to-slate-100 p-6">
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-500">
            {product.images?.[0] ? <img src={product.images[0]} alt={product.name} className="h-full w-full rounded-2xl object-cover" /> : 'Product image'}
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">{product.brand}</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">{product.name}</h1>
          </div>

          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-slate-900">{formatMoney(product.sellingPrice)}</span>
            <span className="text-sm line-through text-slate-400">{formatMoney(product.MRP)}</span>
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">{product.discount || 0}% off</span>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Color</p>
            <div className="flex flex-wrap gap-2">
              {(product.colors || []).map((color) => (
                <button key={color} type="button" onClick={() => setSelectedColor(color)} className={`rounded-full border px-3 py-1.5 text-sm ${selectedColor === color ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-700'}`}>
                  {color}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Size</p>
            <div className="flex flex-wrap gap-2">
              {(product.sizes || []).map((size) => (
                <button key={size} type="button" onClick={() => setSelectedSize(size)} className={`rounded-xl border px-3 py-2 text-sm ${selectedSize === size ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-700'}`}>
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className={`rounded-2xl border px-4 py-3 text-sm ${isAvailable ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {isAvailable ? 'Available in stock' : 'Unavailable for the selected color and size'}
          </div>
        </div>
      </div>
    </div>
  )
}

const RESET_PASSWORD = '987654321'

function LoginPage() {
  const { signIn, user, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true })
    }
  }, [loading, navigate, user])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (submitError) {
      setError(submitError?.message || 'Unable to sign in with Firebase Authentication.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        Loading secure workspace...
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Shoe Shop Admin</p>
          <h1 className="mt-3 text-3xl font-bold text-slate-900">Sign in</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-500"
              placeholder="admin@shoeshop.com"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-500"
              placeholder="Enter your password"
              required
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

function App() {
  const { user, loading: authLoading } = useAuth()
  const [data, setData] = useState(createDefaultStorageData)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    let isActive = true

    const hydrateData = async () => {
      const remoteData = await getRemoteData()
      if (isActive) {
        setData(remoteData)
        setIsHydrated(true)
      }
    }

    hydrateData()

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) return
    saveRemoteData(data)
  }, [data, isHydrated])

  const resetFullApp = () => {
    const enteredPassword = window.prompt('Enter reset password to clear the full web app data:')
    if (enteredPassword !== RESET_PASSWORD) {
      window.alert('Invalid reset password.')
      return
    }

    const confirmed = window.confirm('This will permanently delete all products, sales, inventory, and settings. Continue?')
    if (!confirmed) return

    const freshData = createDefaultStorageData()
    setData(freshData)
    window.alert('The web app has been reset successfully.')
  }

  const saveProduct = (product) => {
    setData((current) => {
      const nextProduct = {
        ...product,
        sku: product.sku || generateUniqueSku(current.products),
        barcode: product.barcode || generateUniqueBarcode(current.products),
        variants: (product.variants || []).map((variant) => ({
          ...variant,
          stock: Number(variant.stock || 0),
          sold: Number(variant.sold || 0),
          serialNumbers: generateStockSerials(Number(variant.stock || 0)),
        })),
        units: (product.units || []).map((unit) => ({
          ...unit,
          productId: product.id,
          status: unit.status === 'sold' ? 'sold' : 'available',
        })),
      }

      return {
        ...current,
        products: [...current.products, nextProduct],
        publicProducts: [...current.publicProducts.filter((item) => item.id !== nextProduct.id), buildPublicProduct(nextProduct)].filter(Boolean),
      }
    })
  }

  const updateProduct = (product) => {
    setData((current) => {
      const nextProduct = {
        ...product,
        sku: product.sku || generateUniqueSku(current.products, product.id),
        barcode: product.barcode || generateUniqueBarcode(current.products, product.id),
        variants: (product.variants || []).map((variant) => ({
          ...variant,
          stock: Number(variant.stock || 0),
          sold: Number(variant.sold || 0),
          serialNumbers: generateStockSerials(Number(variant.stock || 0)),
        })),
        units: (product.units || []).map((unit) => ({
          ...unit,
          productId: product.id,
          status: unit.status === 'sold' ? 'sold' : 'available',
        })),
      }

      return {
        ...current,
        products: current.products.map((item) => (item.id === nextProduct.id ? nextProduct : item)),
        publicProducts: [...current.publicProducts.filter((item) => item.id !== nextProduct.id), buildPublicProduct(nextProduct)].filter(Boolean),
      }
    })
  }

  const deleteProduct = (id) => {
    setData((current) => ({
      ...current,
      products: current.products.filter((item) => item.id !== id),
      publicProducts: current.publicProducts.filter((item) => item.id !== id),
    }))
  }

  const adjustInventory = ({ variantId, type, delta, reason }) => {
    setData((current) => {
      let before = 0
      let after = 0

      const products = current.products.map((product) => ({
        ...product,
        variants: product.variants.map((variant) => {
          if (variant.id !== variantId) return variant
          before = Number(variant.stock || 0)
          after = before + Number(delta || 0)
          const nextStock = Math.max(0, after)
          return { ...variant, stock: nextStock, serialNumbers: generateStockSerials(nextStock) }
        }),
      }))

      return {
        ...current,
        products,
        inventoryTransactions: [{
          id: `txn-${Date.now()}`,
          type,
          variantId,
          delta: Number(delta || 0),
          beforeStock: before,
          afterStock: after,
          reason: reason || 'Local update',
          createdAt: new Date().toISOString(),
        }, ...current.inventoryTransactions],
      }
    })
  }

  const completeSale = ({ invoiceNo, paymentMethod, lineItems, total, taxTotal }) => {
    setData((current) => {
      const nextProducts = current.products.map((product) => {
        const productSaleLineItems = lineItems.filter((entry) => entry.productId === product.id)
        if (!productSaleLineItems.length) return product

        const nextUnits = (product.units || []).map((unit) => {
          const matchedUnitId = productSaleLineItems
            .flatMap((entry) => entry.soldUnitIds || [])
            .find((unitId) => unitId === unit.id)

          if (!matchedUnitId) return unit
          return {
            ...unit,
            status: 'sold',
            soldAt: new Date().toISOString(),
            saleId: `sale-${Date.now()}`,
          }
        })

        const nextVariants = (product.variants || []).map((variant, index) => {
          const soldCount = productSaleLineItems.reduce((sum, entry) => sum + Number(entry.qty || 0), 0)
          if (index === 0) {
            return {
              ...variant,
              stock: Math.max(0, Number(variant.stock || 0) - soldCount),
              sold: Number(variant.sold || 0) + soldCount,
            }
          }
          return variant
        })

        return {
          ...product,
          units: nextUnits,
          variants: nextVariants,
        }
      })

      return {
        ...current,
        products: nextProducts,
        sales: [{
          id: `sale-${Date.now()}`,
          invoiceNo,
          paymentMethod,
          lineItems,
          total,
          taxTotal,
          createdAt: new Date().toISOString(),
        }, ...current.sales],
      }
    })
  }

  const returnProduct = (productId, unitId) => {
    setData((current) => ({
      ...current,
      products: current.products.map((product) => {
        if (product.id !== productId) return product

        return {
          ...product,
          units: (product.units || []).map((unit) =>
            unit.id === unitId
              ? { ...unit, status: 'available', soldAt: null, saleId: null }
              : unit,
          ),
        }
      }),
    }))
  }

  const saveSettings = (settings) => setData((current) => ({ ...current, settings }))

  const exportBackup = () => {
    const payload = JSON.stringify(syncPublicProducts(data), null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shoe-shop-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const importBackup = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'))
        const normalized = syncPublicProducts({
          ...createDefaultStorageData(),
          ...parsed,
          settings: {
            ...createDefaultStorageData().settings,
            ...(parsed.settings || {}),
          },
        })
        setData(normalized)
        window.alert('Backup restored successfully.')
      } catch (error) {
        window.alert('Invalid backup file. Please choose a valid JSON backup.')
      }
      event.target.value = ''
    }
    reader.readAsText(file)
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        Loading secure workspace...
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/product/:productId" element={<PublicProductPage data={data} />} />

      <Route element={<ProtectedRoute /> }>
        <Route path="/dashboard" element={<DashboardPage data={data} />} />
        <Route path="/products" element={<ProductsPage data={data} onDeleteProduct={deleteProduct} />} />
        <Route path="/products/add" element={<ProductEditorPage data={data} onSaveProduct={saveProduct} onUpdateExistingProduct={updateProduct} />} />
        <Route path="/products/:id/edit" element={<ProductEditorPage data={data} onSaveProduct={saveProduct} onUpdateExistingProduct={updateProduct} />} />
        <Route path="/inventory" element={<InventoryPage data={data} onAdjustInventory={adjustInventory} />} />
        <Route path="/billing" element={<BillingPage data={data} onCompleteSale={completeSale} onReturnProduct={returnProduct} settings={data.settings} />} />
        <Route path="/sales" element={<SalesPage data={data} />} />
        <Route path="/qr-codes" element={<QrCodesPage data={data} />} />
        <Route path="/reports" element={<ReportsPage data={data} />} />
        <Route path="/settings" element={<SettingsPage data={data} onSaveSettings={saveSettings} onExportBackup={exportBackup} onImportBackup={importBackup} onResetFullApp={resetFullApp} />} />
      </Route>

      <Route path="/" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  )
}

export default App
