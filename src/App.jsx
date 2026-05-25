// ═════════════════════════════════════════════════════════════════════════════
// DentalFolio — src/App.jsx  (single-file architecture)
// Every component and every utility is consolidated in this one file.
// The only external config is src/config.js — change that file to rebrand.
// ═════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { Plus, Trash2, X } from 'lucide-react'
import { DentalFolioConfig } from './config.js'

const { SECRET_SALT, TIER_MAP, WHATSAPP_NUMBER, APP_NAME, TAGLINE, EGYPT_FACULTIES } = DentalFolioConfig

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CASE_CATEGORIES = [
  'Cosmetic', 'Fixed Prosthodontics', 'Endodontic Treatment',
  'Oral Surgery', 'Periodontics', 'Pediatric',
  'Removable Prosthodontics', 'Orthodontics', 'Other',
]

const DEFAULT_DOCTOR = {
  name: '', title: '', graduationYear: '', university: '',
  phone: '', whatsapp: '', email: '', website: '',
  skills: { clinical: '', digital: '', soft: '' },
  timeline: [], profileImage: null,
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE OPTIMIZER  (concurrency queue — max 3 parallel compressions)
// ─────────────────────────────────────────────────────────────────────────────

let _iqActive = 0
const _iqQueue = []

function _iqNext() {
  if (!_iqQueue.length || _iqActive >= 3) return
  const { file, opts, resolve, reject } = _iqQueue.shift()
  _iqActive++
  imageCompression(file, opts)
    .then(r => { _iqActive--; resolve(r); _iqNext() })
    .catch(e => { _iqActive--; reject(e); _iqNext() })
}

function optimizeImage(file, maxSizeKB = 300) {
  return new Promise((resolve, reject) => {
    _iqQueue.push({
      file,
      opts: { maxSizeMB: Math.max(0.03, maxSizeKB / 1024), maxWidthOrHeight: 2400, useWebWorker: true, initialQuality: 0.8 },
      resolve,
      reject,
    })
    _iqNext()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function hmacHex(message, salt) {
  const enc = new TextEncoder()
  const k   = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig  = await crypto.subtle.sign('HMAC', k, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function ctEqual(a, b) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF METADATA ENCODE / DECODE
// ─────────────────────────────────────────────────────────────────────────────

function _enc(s) { try { return btoa(unescape(encodeURIComponent(s||''))) } catch { return btoa(s || '') } }
function _dec(b) { try { return decodeURIComponent(escape(atob(b || ''))) } catch { try { return atob(b || '') } catch { return '' } } }
function _parseMeta(raw) {
  try {
    if (!raw) return null
    const p = String(raw).split('|')
    if (!p[0]?.startsWith('DentalFolio-V1')) return null
    return { doctorName: _dec(p[1]||''), maxCases: parseInt(p[2]||'0', 10)||0, usedCases: parseInt(p[3]||'0', 10)||0, activationKey: _dec(p[4]||'') }
  } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF LAYOUT PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

const PW = 595, PH = 842, PM = 44
const C_DARK = rgb(0.06, 0.10, 0.18)
const C_MID  = rgb(0.25, 0.25, 0.25)
const C_GREY = rgb(0.45, 0.45, 0.45)

function pdfWrap(text, size, font, maxW) {
  if (!text?.trim()) return []
  const lines = []
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push(''); continue }
    const words = para.split(' ').filter(Boolean)
    let cur = ''
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word
      if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = word }
      else cur = test
    }
    if (cur) lines.push(cur)
  }
  return lines
}

function pdfCX(text, size, font) {
  return Math.max(PM, (PW - font.widthOfTextAtSize(text, size)) / 2)
}

function pdfDC(page, text, y, size, font, color = rgb(0,0,0)) {
  if (!text?.trim()) return
  page.drawText(text, { x: pdfCX(text, size, font), y, size, font, color })
}

function pdfDCW(page, text, y, size, font, color = rgb(0,0,0), maxW = PW - PM*2) {
  if (!text?.trim()) return y
  let cy = y
  for (const line of pdfWrap(text, size, font, maxW)) {
    if (line.trim()) pdfDC(page, line, cy, size, font, color)
    cy -= size * 1.6
  }
  return cy
}

function pdfHeader(page, name, num, total, f) {
  const y = PH - 24
  page.drawText(`Dr. ${name}`, { x: PM, y, size: 9, font: f, color: rgb(0.45,0.45,0.45) })
  const t = `Page ${num} of ${total}`
  page.drawText(t, { x: PW - PM - f.widthOfTextAtSize(t, 9), y, size: 9, font: f, color: rgb(0.45,0.45,0.45) })
  page.drawLine({ start:{x:PM,y:y-7}, end:{x:PW-PM,y:y-7}, thickness: 0.5, color: rgb(0.78,0.78,0.78) })
}

function pdfFooter(page, name, year, f) {
  page.drawLine({ start:{x:PM,y:34}, end:{x:PW-PM,y:34}, thickness: 0.3, color: rgb(0.82,0.82,0.82) })
  pdfDC(page, `© ${year} Dr. ${name}`, 18, 8, f, rgb(0.58,0.58,0.58))
}

function pdfDivider(page, y, short = false) {
  const pad = short ? 130 : PM
  page.drawLine({ start:{x:pad,y}, end:{x:PW-pad,y}, thickness: 0.4, color: rgb(0.78,0.78,0.78) })
}

function pdfNewPage(doc) {
  const p = doc.addPage([PW, PH])
  p.drawRectangle({ x:0, y:0, width:PW, height:PH, color:rgb(1,1,1) })
  return p
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

async function generateDentalPDF({ doctor, cases = [], maxCases = 20, usedCases = 0, activationKey = '' }) {
  const pdfDoc = await PDFDocument.create()
  const metaStr = `DentalFolio-V1|${_enc(doctor.name||'')}|${maxCases}|${usedCases}|${_enc(activationKey)}`
  try { pdfDoc.setKeywords?.([metaStr]) } catch {}
  try { pdfDoc.setTitle?.('DentalFolio Portfolio') } catch {}

  const R  = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const B  = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const I  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const hasSkills  = !!(doctor.skills?.clinical || doctor.skills?.digital || doctor.skills?.soft)
  const hasEdu     = !!(doctor.university || doctor.timeline?.length)
  const hasCases   = cases.length > 0
  const hasWebsite = !!doctor.website?.trim()
  const year       = doctor.graduationYear || String(new Date().getFullYear())
  const total      = 1 + (hasSkills?1:0) + (hasEdu?1:0) + (hasCases?1:0) + cases.length + (hasWebsite?1:0)
  let pn = 0

  // ── Cover Page ────────────────────────────────────────────────────────────
  pn++
  const cover = pdfNewPage(pdfDoc)
  cover.drawRectangle({ x:28, y:28, width:PW-56, height:PH-56, color:rgb(0.985,0.985,0.985) })

  let imgBot = PH - 50
  if (doctor.profileImage?.blob) {
    try {
      const bytes = await doctor.profileImage.blob.arrayBuffer()
      const img   = doctor.profileImage.blob.type === 'image/png'
        ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
      const cap = 148, sc = Math.min(cap/img.width, cap/img.height)
      const dw = img.width*sc, dh = img.height*sc, ix = (PW-dw)/2, iy = PH-60-dh
      imgBot = iy
      cover.drawRectangle({ x:ix-4, y:iy-4, width:dw+8, height:dh+8, color:rgb(1,1,1) })
      cover.drawRectangle({ x:ix-4, y:iy-4, width:dw+8, height:dh+8, borderColor:rgb(0.85,0.85,0.85), borderWidth:1 })
      cover.drawImage(img, { x:ix, y:iy, width:dw, height:dh })
    } catch(e) { console.debug('profile embed', e) }
  }

  let cy = imgBot - 32
  pdfDC(cover, `DR. ${(doctor.name||'').toUpperCase()}`, cy, 22, B, C_DARK)
  if (doctor.title) { cy -= 22; pdfDC(cover, doctor.title, cy, 12, I, C_GREY) }
  cy -= 18; pdfDivider(cover, cy, true); cy -= 16

  if (doctor.graduationYear || doctor.university) {
    const gl = [doctor.graduationYear ? `Graduated ${doctor.graduationYear}` : '', doctor.university]
      .filter(Boolean).join('  ·  ')
    cy = pdfDCW(cover, gl, cy, 10, R, C_MID, PW - PM*2 - 20); cy -= 8
  }

  cy -= 28
  const contacts = []
  if (doctor.phone)    contacts.push(['Phone',    doctor.phone])
  if (doctor.whatsapp) contacts.push(['WhatsApp', doctor.whatsapp])
  if (doctor.email)    contacts.push(['Email',    doctor.email])
  for (const [label, value] of contacts) {
    const lw = R.widthOfTextAtSize(`${label}:  `, 11)
    const sx = Math.max(PM, (PW - lw - R.widthOfTextAtSize(value, 11)) / 2)
    cover.drawText(`${label}:  `, { x:sx, y:cy, size:11, font:B, color:C_MID })
    cover.drawText(value,          { x:sx+lw, y:cy, size:11, font:R, color:C_MID })
    cy -= 22
  }
  pdfFooter(cover, doctor.name||'Doctor', year, R)

  // ── Professional Skills ───────────────────────────────────────────────────
  if (hasSkills) {
    pn++
    const sp = pdfNewPage(pdfDoc)
    pdfHeader(sp, doctor.name||'Doctor', pn, total, R)
    pdfFooter(sp, doctor.name||'Doctor', year, R)
    let sy = PH - 68
    pdfDC(sp, 'PROFESSIONAL SKILLS', sy, 16, B, C_DARK); sy -= 10; pdfDivider(sp, sy); sy -= 34
    for (const [lbl, txt] of [['Clinical Skills', doctor.skills.clinical], ['Digital Skills', doctor.skills.digital], ['Soft Skills', doctor.skills.soft]]) {
      if (!txt?.trim()) continue
      pdfDC(sp, lbl, sy, 12, B, C_MID); sy -= 18
      sy = pdfDCW(sp, txt, sy, 10, R, C_GREY, PW - PM*2 - 20); sy -= 24
    }
  }

  // ── Education & Career ────────────────────────────────────────────────────
  if (hasEdu) {
    pn++
    const ep = pdfNewPage(pdfDoc)
    pdfHeader(ep, doctor.name||'Doctor', pn, total, R)
    pdfFooter(ep, doctor.name||'Doctor', year, R)
    let ey = PH - 68
    pdfDC(ep, 'EDUCATION & CAREER', ey, 16, B, C_DARK); ey -= 10; pdfDivider(ep, ey); ey -= 36
    if (doctor.university) { ey = pdfDCW(ep, doctor.university, ey, 13, B, C_MID, PW-PM*2); ey -= 6 }
    if (doctor.graduationYear) { pdfDC(ep, `Graduated: ${doctor.graduationYear}`, ey, 11, R, C_GREY); ey -= 32 }
    for (const e of (doctor.timeline||[])) {
      if (!e.year && !e.event) continue
      ey = pdfDCW(ep, `${e.year}${e.year&&e.event ? '  \u2014  ' : ''}${e.event}`, ey, 10, R, C_MID, PW-PM*2)
      ey -= 8
    }
  }

  // ── Cases Divider Page ────────────────────────────────────────────────────
  if (hasCases) {
    pn++
    const dp = pdfNewPage(pdfDoc)
    pdfHeader(dp, doctor.name||'Doctor', pn, total, R)
    pdfFooter(dp, doctor.name||'Doctor', year, R)
    pdfDC(dp, 'CLINICAL CASES PORTFOLIO', PH/2 + 20, 20, B, C_DARK)
    pdfDivider(dp, PH/2 + 6)
  }

  // ── Individual Case Pages ─────────────────────────────────────────────────
  for (const c of cases) {
    pn++
    const cp = pdfNewPage(pdfDoc)
    pdfHeader(cp, doctor.name||'Doctor', pn, total, R)
    pdfFooter(cp, doctor.name||'Doctor', year, R)

    let cy2 = PH - 52
    pdfDC(cp, c.category||'', cy2, 16, B, C_DARK); cy2 -= 22
    if (c.title?.trim()) { cy2 = pdfDCW(cp, c.title, cy2, 12, R, C_MID, PW-PM*2); cy2 -= 8 }

    const descH   = c.description?.trim() ? 30 : 0
    const imgAreaT = cy2 - 8
    const imgAreaB = 50 + descH + 8
    const imgAreaH = imgAreaT - imgAreaB
    const imgAreaW = PW - PM*2

    if (c.file) {
      try {
        const bytes = await c.file.arrayBuffer()
        const img   = c.file.type === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
        const sc    = Math.min(imgAreaW/img.width, imgAreaH/img.height)
        const dw = img.width*sc, dh = img.height*sc
        cp.drawImage(img, { x:(PW-dw)/2, y: imgAreaB + (imgAreaH - descH - dh)/2, width:dw, height:dh })
      } catch(e) { console.debug('case img', e) }
    }
    if (c.description?.trim()) pdfDCW(cp, c.description.slice(0, 250), 54, 10, I, C_GREY, PW-PM*2)
  }

  // ── Complete Portfolio (website) Page ─────────────────────────────────────
  if (hasWebsite) {
    pn++
    const fp = pdfNewPage(pdfDoc)
    pdfHeader(fp, doctor.name||'Doctor', pn, total, R)
    pdfFooter(fp, doctor.name||'Doctor', year, R)
    let fy = PH/2 + 60
    pdfDC(fp, 'COMPLETE PORTFOLIO', fy, 18, B, C_DARK); fy -= 14
    pdfDivider(fp, fy, true); fy -= 32
    pdfDC(fp, 'For complete portfolio and additional cases', fy, 11, R, C_GREY); fy -= 20
    pdfDC(fp, 'please visit my professional website:', fy, 11, R, C_GREY); fy -= 22
    pdfDC(fp, doctor.website, fy, 10, R, rgb(0.04, 0.35, 0.73))
  }

  return new Blob([await pdfDoc.save()], { type: 'application/pdf' })
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF METADATA PARSER
// ─────────────────────────────────────────────────────────────────────────────

async function parseDentalMetadata(file) {
  try {
    if (!file) return { meta:null, error:'no_file' }
    if (file.type !== 'application/pdf' && !file.name?.toLowerCase().endsWith('.pdf'))
      return { meta:null, error:'not_pdf' }
    if (file.size > 50*1024*1024) return { meta:null, error:'file_too_large' }
    let pdfDoc
    try { pdfDoc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }) }
    catch { return { meta:null, error:'corrupted_or_encrypted' } }
    const kw   = typeof pdfDoc.getKeywords === 'function' ? pdfDoc.getKeywords() : null
    let   meta = Array.isArray(kw) && kw.length ? _parseMeta(kw[0]) : null
    if (!meta) meta = _parseMeta(typeof pdfDoc.getTitle === 'function' ? pdfDoc.getTitle() : null)
    return meta ? { meta, error:null } : { meta:null, error:'no_dentalfolio_metadata' }
  } catch { return { meta:null, error:'unexpected' } }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLE TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const INP = 'w-full p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const LBL = 'block text-xs font-medium text-slate-600 mb-1 mt-3'

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: Header
// ─────────────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="7" y1="8" x2="17" y2="8"/>
              <line x1="7" y1="12" x2="14" y2="12"/>
              <line x1="7" y1="16" x2="11" y2="16"/>
            </svg>
          </div>
          <div>
            <span className="font-bold text-lg text-slate-900 leading-none">{APP_NAME}</span>
            <p className="text-xs text-slate-500 leading-none mt-0.5 hidden sm:block">{TAGLINE}</p>
          </div>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <a href="#" className="text-slate-600 hover:text-slate-900 transition-colors">How it works</a>
          <a href="#" className="text-slate-600 hover:text-slate-900 transition-colors">Pricing</a>
        </nav>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: Section  (collapsible card wrapper)
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4 bg-white">{children}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: DoctorForm
// ─────────────────────────────────────────────────────────────────────────────

function DoctorForm({ doctor, setDoctor, appendMode, onImportPDF }) {
  const patch      = (p) => setDoctor(d => ({ ...d, ...p }))
  const patchSkill = (key, val) =>
    setDoctor(d => ({ ...d, skills: { ...d.skills, [key]: val } }))

  async function handlePhoto(file) {
    if (!file) return
    try {
      const comp = await imageCompression(file, { maxSizeMB: 0.4, maxWidthOrHeight: 2000, useWebWorker: true })
      patch({ profileImage: { blob: comp, url: URL.createObjectURL(comp) } })
    } catch(e) { console.debug('photo', e); alert('Failed to process image — try a smaller file.') }
  }

  const addRow    = () => setDoctor(d => ({ ...d, timeline: [...(d.timeline||[]), { year:'', event:'' }] }))
  const editRow   = (i, f, v) =>
    setDoctor(d => { const t = [...(d.timeline||[])]; t[i] = { ...t[i], [f]: v }; return { ...d, timeline: t } })
  const removeRow = (i) => setDoctor(d => ({ ...d, timeline: (d.timeline||[]).filter((_,j) => j !== i) }))

  return (
    <div className="space-y-3">

      {/* ── Personal ── */}
      <Section title="Personal Information">
        <label className={LBL}>Full Name *</label>
        <input value={doctor.name} readOnly={!!appendMode}
          onChange={e => patch({ name: e.target.value })} className={INP} placeholder="e.g. Michael Nabil" />

        <label className={LBL}>Title / Role</label>
        <input value={doctor.title}
          onChange={e => patch({ title: e.target.value })} className={INP} placeholder="e.g. Internship Dentist" />

        <label className={LBL}>Graduation Year</label>
        <input value={doctor.graduationYear}
          onChange={e => patch({ graduationYear: e.target.value })} className={INP} placeholder="e.g. 2025" />

        <label className={LBL}>University</label>
        <input value={doctor.university} list="df-univ"
          onChange={e => patch({ university: e.target.value })} className={INP}
          placeholder="e.g. Egyptian Russian University Faculty of Dentistry" />
        <datalist id="df-univ">
          {EGYPT_FACULTIES.map(f => <option key={f} value={f} />)}
        </datalist>
      </Section>

      {/* ── Contact ── */}
      <Section title="Contact Details">
        <label className={LBL}>Phone</label>
        <input value={doctor.phone} type="tel"
          onChange={e => patch({ phone: e.target.value })} className={INP} placeholder="+201271476215" />

        <label className={LBL}>WhatsApp</label>
        <input value={doctor.whatsapp} type="tel"
          onChange={e => patch({ whatsapp: e.target.value })} className={INP} placeholder="+201271476215" />

        <label className={LBL}>Email</label>
        <input value={doctor.email} type="email"
          onChange={e => patch({ email: e.target.value })} className={INP} placeholder="doctor@email.com" />

        <label className={LBL}>Website URL</label>
        <input value={doctor.website} type="url"
          onChange={e => patch({ website: e.target.value })} className={INP} placeholder="https://portfoliohubs.github.io/yourname/" />
      </Section>

      {/* ── Photo ── */}
      <Section title="Profile Photo">
        <div className="flex items-center gap-4 pt-2">
          <input type="file" accept="image/*"
            className="text-sm text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
            onChange={e => handlePhoto(e.target.files?.[0])} />
          {doctor.profileImage?.url && (
            <img src={doctor.profileImage.url} alt="profile"
              className="w-16 h-16 object-cover rounded-lg border-2 border-slate-200 flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-slate-400 mt-2">Recommended: square photo, at least 400 × 400 px</p>
      </Section>

      {/* ── Skills ── */}
      <Section title="Professional Skills">
        <p className="text-xs text-slate-400 mt-2 mb-1">Separate items with  •  or commas</p>
        <label className={LBL}>Clinical Skills</label>
        <textarea value={doctor.skills.clinical} rows={2} className={INP}
          onChange={e => patchSkill('clinical', e.target.value)}
          placeholder="Oral Surgery • Endodontics • Prosthodontics • Cosmetic Dentistry" />

        <label className={LBL}>Digital Skills</label>
        <textarea value={doctor.skills.digital} rows={2} className={INP}
          onChange={e => patchSkill('digital', e.target.value)}
          placeholder="Dental portfolio creator • Digital Documentation • Microsoft PowerPoint" />

        <label className={LBL}>Soft Skills</label>
        <textarea value={doctor.skills.soft} rows={2} className={INP}
          onChange={e => patchSkill('soft', e.target.value)}
          placeholder="Patient Communication • Treatment Planning • Time Management" />
      </Section>

      {/* ── Timeline ── */}
      <Section title="Career Timeline">
        <p className="text-xs text-slate-400 mt-2 mb-3">Milestones shown on the Education page</p>
        <div className="space-y-2">
          {(doctor.timeline||[]).map((entry, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input value={entry.year} onChange={e => editRow(i,'year',e.target.value)} placeholder="2025"
                className="w-20 p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={entry.event} onChange={e => editRow(i,'event',e.target.value)}
                placeholder="Graduated from Faculty of Dentistry"
                className="flex-1 p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => removeRow(i)}
                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
          <Plus size={14} /> Add Milestone
        </button>
      </Section>

      {/* ── Import ── */}
      <Section title="Import Existing PDF  (Append Mode)">
        <p className="text-xs text-slate-400 mt-2 mb-2">Upload a previous DentalFolio PDF to add more cases to it</p>
        <input type="file" accept="application/pdf"
          className="text-sm text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          onChange={e => { if (e.target.files?.[0]) onImportPDF(e.target.files[0]) }} />
      </Section>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: CaseManager
// ─────────────────────────────────────────────────────────────────────────────

function CaseManager({ cases, setCases, maxCases, usedCases }) {
  const [filter, setFilter] = useState('All')
  const remaining = Math.max(0, maxCases - usedCases - cases.length)

  async function addCase(file) {
    if (cases.length + usedCases >= maxCases) {
      alert(`Limit reached. You can still add ${remaining} more case(s).`); return
    }
    try {
      const opt = await optimizeImage(file, 300)
      setCases(prev => [...prev, {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        category: 'Cosmetic', title: '', description: '', file: opt, url: URL.createObjectURL(opt),
      }])
    } catch(e) { console.debug('addCase', e); alert('Failed to optimize image — try a different photo.') }
  }

  const update = (id, p) => setCases(prev => prev.map(c => c.id===id ? {...c,...p} : c))
  const remove = (id) => setCases(prev => prev.filter(c => c.id !== id))
  const visible = cases.filter(c => filter === 'All' || c.category === filter)

  return (
    <section className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          Cases
          <span className="ml-2 text-sm font-normal text-slate-400">
            {usedCases} used · {maxCases} max · {remaining} remaining
          </span>
        </h2>
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option>All</option>
          {CASE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>

        <label className="cursor-pointer px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
          + Add Images
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={e => { Array.from(e.target.files||[]).forEach(f => addCase(f)); e.target.value = '' }} />
        </label>

        <span className="ml-auto text-sm text-slate-400">{cases.length} / {maxCases - usedCases} added</span>
      </div>

      {visible.length === 0 && (
        <div className="text-center py-14 text-slate-400">
          <p className="text-lg mb-1 font-medium">No cases yet</p>
          <p className="text-sm">Click "+ Add Images" to upload clinical case photos</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visible.map(c => (
          <div key={c.id} className="border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition-colors">
            <img src={c.url} alt="case" className="w-full h-40 object-contain bg-slate-100" />
            <div className="p-3 space-y-2">
              <select value={c.category} onChange={e => update(c.id, { category: e.target.value })}
                className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CASE_CATEGORIES.map(cat => <option key={cat}>{cat}</option>)}
              </select>

              <input value={c.title} onChange={e => update(c.id, { title: e.target.value })}
                className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Case title (e.g. class IV Composite)" />

              <textarea maxLength={250} rows={2} value={c.description}
                onChange={e => update(c.id, { description: e.target.value })}
                className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Short description (e.g. Treatment with composite)" />

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{c.description.length}/250</span>
                <button onClick={() => remove(c.id)}
                  className="flex items-center gap-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg text-xs font-medium transition-colors">
                  <Trash2 size={11} /> Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: KeyValidator
// ─────────────────────────────────────────────────────────────────────────────

function KeyValidator({ doctor, activationKey, setActivationKey, unlocked, setUnlocked, maxCases, usedCases, setMaxCases }) {
  const tierNames = Object.keys(TIER_MAP)
  const [tier, setTier] = useState(tierNames[1] ?? tierNames[0])

  async function validate() {
    if (!doctor.email) return alert('Enter your email in the form first')
    const limit = TIER_MAP[tier]
    try {
      const expected = await hmacHex(`${doctor.email}|${limit}`, SECRET_SALT)
      const provided  = activationKey.replace(/\s/g, '').toLowerCase()
      if (provided.length !== expected.length) {
        setUnlocked(false); alert('Invalid key format — key should be 64 hex characters'); return
      }
      if (ctEqual(provided, expected)) {
        setUnlocked(true); setMaxCases(limit)
        alert(`Activation successful — ${tier} plan (${limit} cases) unlocked`)
      } else {
        setUnlocked(false); alert('Invalid Activation Key')
      }
    } catch(e) { console.debug('validate', e); alert('Activation failed — internal error') }
  }

  return (
    <section className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
      <h3 className="font-semibold mb-3 text-slate-900">Activation</h3>

      <label className="block text-xs font-medium text-slate-600 mb-1">Plan</label>
      <select value={tier} onChange={e => setTier(e.target.value)}
        className="w-full p-2 border border-slate-300 rounded-lg mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {Object.entries(TIER_MAP).map(([name, limit]) => (
          <option key={name} value={name}>{name} — {limit} cases</option>
        ))}
      </select>

      <label className="block text-xs font-medium text-slate-600 mb-1">Activation Key</label>
      <input value={activationKey} onChange={e => setActivationKey(e.target.value)}
        className="w-full p-2 border border-slate-300 rounded-lg mb-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="64-character hex key" />

      <div className="flex gap-2 mb-3">
        <button onClick={validate}
          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
          Validate Key
        </button>
        <a href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hello, I want to purchase the ${tier} plan. My email: ${doctor.email||''}`)}`}
          target="_blank" rel="noreferrer"
          className="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors text-center">
          Buy via WhatsApp
        </a>
      </div>

      <div className={`flex items-center gap-2 text-sm ${unlocked ? 'text-emerald-600' : 'text-slate-500'}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${unlocked ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        {unlocked
          ? `Unlocked — ${maxCases} cases max (${usedCases} used)`
          : 'Locked — enter your activation key to unlock downloads'}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [doctor,       setDoctor]       = useState(DEFAULT_DOCTOR)
  const [cases,        setCases]        = useState([])
  const [maxCases,     setMaxCases]     = useState(20)
  const [usedCases,    setUsedCases]    = useState(0)
  const [activationKey,setActivationKey]= useState('')
  const [unlocked,     setUnlocked]     = useState(false)
  const [appendMode,   setAppendMode]   = useState(false)
  const [hydrated,     setHydrated]     = useState(false)

  // Restore persisted state on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dentalfolio:state')
      if (saved) {
        const p = JSON.parse(saved)
        setDoctor({ ...DEFAULT_DOCTOR, ...p.doctor,
          skills:   { ...DEFAULT_DOCTOR.skills, ...p.doctor?.skills },
          timeline: p.doctor?.timeline || [],
        })
        setCases([])
        setMaxCases(p.maxCases ?? 20)
        setUsedCases(p.usedCases ?? 0)
        setActivationKey(p.activationKey || '')
        setUnlocked(p.unlocked || false)
        setAppendMode(p.appendMode || false)
      }
    } catch(e) { console.debug('restore', e) }
    finally { setHydrated(true) }
  }, [])

  // Persist state on every change (debounced)
  useEffect(() => {
    if (!hydrated) return
    const id = setTimeout(() => {
      try {
        localStorage.setItem('dentalfolio:state', JSON.stringify({
          doctor, maxCases, usedCases, activationKey, unlocked, appendMode,
        }))
      } catch(e) { console.debug('persist', e) }
    }, 400)
    return () => clearTimeout(id)
  }, [doctor, maxCases, usedCases, activationKey, unlocked, appendMode, hydrated])

  async function downloadPDF() {
    if (!unlocked) return alert('Please enter a valid Activation Key to unlock downloads.')
    try {
      const blob = await generateDentalPDF({ doctor, cases, maxCases, usedCases, activationKey })
      const url  = URL.createObjectURL(blob)
      if (/iP(ad|hone|od)/.test(navigator.userAgent) && !window.MSStream)
        alert("On iOS: in the new tab tap the Share icon → 'Save to Files' to download.")
      const a = Object.assign(document.createElement('a'), { href: url, download: `${doctor.name || APP_NAME}.pdf` })
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch(e) {
      console.debug('PDF', e)
      alert('Failed to generate PDF. Try removing very large images and retrying.')
    }
  }

  async function importPDF(file) {
    const { meta, error } = await parseDentalMetadata(file)
    if (error) {
      const msgs = {
        no_file:'No file provided.', not_pdf:'File is not a PDF.',
        file_too_large:'File exceeds 50 MB limit.',
        corrupted_or_encrypted:'File is corrupted or encrypted.',
        no_dentalfolio_metadata:'This PDF contains no DentalFolio metadata.',
        metadata_parse_error:'Could not read metadata.', unexpected:'Unknown error.',
      }
      alert(msgs[error] ?? 'Import failed.'); return
    }
    if (meta) {
      setAppendMode(true)
      setDoctor(d => ({ ...d, name: meta.doctorName }))
      setMaxCases(meta.maxCases)
      setUsedCases(meta.usedCases)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        {!hydrated ? (
          <div className="text-center py-20 text-slate-500">Restoring your session…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">

            {/* ── Left: form + activation + actions ── */}
            <div className="xl:col-span-2 space-y-4">
              <DoctorForm
                doctor={doctor} setDoctor={setDoctor}
                appendMode={appendMode} onImportPDF={importPDF}
              />
              <KeyValidator
                doctor={doctor}
                activationKey={activationKey} setActivationKey={setActivationKey}
                unlocked={unlocked} setUnlocked={setUnlocked}
                maxCases={maxCases} usedCases={usedCases} setMaxCases={setMaxCases}
              />
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hello, I want to purchase a plan. My email is: ${doctor.email||''}`)}`}
                target="_blank" rel="noreferrer"
                className="block w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-center transition-colors"
              >
                Contact via WhatsApp to Purchase
              </a>
              <button
                disabled={!unlocked}
                onClick={downloadPDF}
                className={`w-full py-3 px-4 rounded-xl text-white font-semibold transition-all shadow-sm ${unlocked ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200 shadow-md' : 'bg-slate-300 cursor-not-allowed opacity-60'}`}
              >
                {unlocked ? `⬇  Download Portfolio PDF` : 'Locked — Activate to Download'}
              </button>
            </div>

            {/* ── Right: case grid ── */}
            <div className="xl:col-span-3">
              <CaseManager
                cases={cases} setCases={setCases}
                maxCases={maxCases} usedCases={usedCases}
              />
            </div>

          </div>
        )}
      </main>
    </div>
  )
}
