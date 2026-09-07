/**
 * api/sirekon-proxy.js
 * ---------------------------------------------------------------------
 * Serverless Function (Vercel) yang menjadi perantara antara frontend
 * Lapor Bang!! dan API SiREKON (dashboard_publik.php).
 *
 * KENAPA PERLU INI:
 * Hosting SiREKON (freedev.app) memblokir request fetch() lintas-domain
 * yang membawa header "Origin" dari browser (kemungkinan proteksi
 * anti-hotlink/anti-CSRF di level proxy openresty mereka), sehingga
 * header CORS dari PHP tidak pernah sampai ke browser.
 *
 * Function ini berjalan di server Vercel (bukan di browser pengguna),
 * jadi request ke SiREKON dilakukan server-to-server TANPA header
 * Origin browser sama sekali -> tidak lagi diblokir. Browser pengguna
 * cukup memanggil endpoint SAMA-DOMAIN ini (/api/sirekon-proxy), jadi
 * tidak ada isu CORS sama sekali di sisi browser.
 *
 * DEPLOY:
 * Taruh file ini di /api/sirekon-proxy.js pada root project Vercel
 * (sejajar dengan index.html). Vercel otomatis mendeteksi folder /api
 * sebagai Serverless Functions, tidak perlu konfigurasi tambahan.
 * ---------------------------------------------------------------------
 */

const SIREKON_UPSTREAM = 'https://sirekon-biroadbangsultra-prov.freedev.app/api/dashboard_publik.php';
const ALLOWED_TYPES = ['ringkasan', 'tren', 'status'];

export default async function handler(req, res) {
    // Hanya izinkan GET
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ success: false, error: 'Method tidak diizinkan.' });
    }

    const type = (req.query.type || 'ringkasan').toString();
    if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({
            success: false,
            error: 'Parameter type tidak valid.',
            allowed: ALLOWED_TYPES,
        });
    }

    try {
        const upstreamRes = await fetch(`${SIREKON_UPSTREAM}?type=${encodeURIComponent(type)}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            // Timeout manual via AbortController supaya tidak menggantung lama
            signal: AbortSignal.timeout(10000),
        });

        const text = await upstreamRes.text();

        // Cache di edge Vercel selama 2 menit, selaras dengan cache di sisi SiREKON.
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        // Validasi ringan: pastikan upstream benar-benar mengirim JSON,
        // bukan halaman HTML (mis. jika suatu saat SiREKON kembali memblokir).
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            return res.status(502).json({
                success: false,
                error: 'Respons dari SiREKON tidak valid (bukan JSON). Kemungkinan diblokir di sisi hosting SiREKON.',
            });
        }

        return res.status(upstreamRes.status).json(parsed);
    } catch (err) {
        return res.status(502).json({
            success: false,
            error: 'Gagal menghubungi server SiREKON.',
            detail: err?.message || String(err),
        });
    }
}
