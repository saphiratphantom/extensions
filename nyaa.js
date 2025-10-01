import AbstractSource from './abstract.js'

const QUALITIES = ['1080', '720', '540', '480']

/**
 * Nyaa.si extension for Hayase
 * - Implements the same AbstractSource interface used by other torrent sources.
 * - Uses Nyaa's RSS feed and parses a minimal set of fields without extra deps.
 */
export default new class Nyaa extends AbstractSource {
  // 'https://nyaa.si'
  url = atob('aHR0cHM6Ly9ueWFhLnNp')

  /**
   * Build an additional query part based on resolution and exclusions.
   * Mirrors the pattern used by animetosho.js.
   */
  buildQuery ({ resolution, exclusions }) {
    if (!exclusions?.length && !resolution) return ''
    const base = ` ${exclusions?.length ? '-(' + exclusions.join('|') + ')' : ''}`
    if (!resolution) return base
    const excl = QUALITIES.filter(q => q !== resolution)
    return base + ` -(${excl.map(q => `"${q}p"`).join('|')})`
  }

  /**
   * Compose the search string from titles/episode and add filters.
   * @param {object} options
   * @param {string[]} [options.titles]
   * @param {number|string} [options.episode]
   * @param {string} [options.resolution]
   * @param {string[]} [options.exclusions]
   * @returns {Promise<string>} RSS URL
   */
  async query ({ titles = [], episode, resolution, exclusions } = {}) {
    const t = titles[0] || ''
    const ep = (episode ?? '').toString().padStart(2, '0')
    const q = [t, ep].filter(Boolean).join(' ')
    const filter = this.buildQuery({ resolution, exclusions })
    const encoded = encodeURIComponent((q + filter).trim())
    // anime English-translated category is 1_2
    return `${this.url}/?page=rss&f=0&c=1_2&q=${encoded}`
  }

  /**
   * Fetch and minimally parse the RSS feed items.
   * We rely on basic regex parsing to avoid external XML deps.
   */
  async getItems (rssUrl) {
    const res = await fetch(rssUrl)
    if (!res.ok) return []
    const xml = await res.text()

    // Split by <item>...</item>
    const items = Array.from(xml.matchAll(/<item>([\\s\\S]*?)<\\/item>/g)).map(m => m[1])
    return items.map(raw => {
      const get = (tag, def = '') => {
        const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
        return m ? m[1] : def
      }
      const getNS = (tag, def = '') => {
        const m = raw.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}[^>]*>`, 'i'))
        return m ? m[1] : def
      }

      const title = get('title')
      const link = get('link')
      const pubDate = get('pubDate')
      const seeders = parseInt(getNS('nyaa:seeders', '0'), 10) || 0
      const leechers = parseInt(getNS('nyaa:leechers', '0'), 10) || 0
      const infoHash = getNS('nyaa:infoHash', '')
      const magnet = (raw.match(/(magnet:\\?xt=urn:[^"'<\\s]+)/i) || [])[1] || ''

      // Try to read size: <torrent:contentLength> (bytes) or from description
      const sizeTag = getNS('torrent:contentLength', '0')
      let size = parseInt(sizeTag, 10)
      if (!Number.isFinite(size) || size <= 0) {
        const desc = get('description', '')
        const m = desc.match(/Size:\\s*([^<]+)/i)
        size = m ? 0 : 0 // leave 0 if we can't parse bytes reliably
      }

      const createdAt = pubDate ? new Date(pubDate) : new Date()

      return { title, link, infoHash, magnet, seeders, leechers, size, createdAt }
    })
  }

  /**
   * Normalize to Hayase torrent result objects (similar to seadex.js).
   */
  normalize (items) {
    return items.map(it => ({
      title: it.title,
      infoHash: it.infoHash,
      magnet: it.magnet || (it.infoHash ? `magnet:?xt=urn:btih:${it.infoHash}` : ''),
      seeders: it.seeders ?? 0,
      leechers: it.leechers ?? 0,
      size: it.size ?? 0,
      createdAt: it.createdAt || new Date(),
      downloads: 0,
      accuracy: 'high',
      // Optional: provide a page URL for clicking
      pageUrl: it.link
    }))
  }

  /** @type {import('./').SearchFunction} */
  async single (options = {}) {
    const rss = await this.query(options)
    const items = await this.getItems(rss)
    return this.normalize(items)
  }

  // For simplicity, reuse single()
  batch = this.single
  movie = this.single

  async test () {
    const res = await fetch(`${this.url}/?page=rss&q=test`)
    return res.ok
  }
}()
