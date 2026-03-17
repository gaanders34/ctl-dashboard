/**
 * Writes supabase-config.js from environment variables.
 * Use on Netlify (or similar): set CTL_SUPABASE_URL and CTL_SUPABASE_ANON_KEY, then run:
 *   node scripts/write-supabase-config.js
 */
const fs = require('fs');
const path = require('path');
const url = process.env.CTL_SUPABASE_URL || '';
const key = process.env.CTL_SUPABASE_ANON_KEY || '';
const out = path.join(__dirname, '..', 'supabase-config.js');
const content =
  '/* Generated from env — do not commit if it contains real keys */\n' +
  'window.CTL_SUPABASE_URL = ' + JSON.stringify(url) + ';\n' +
  'window.CTL_SUPABASE_ANON_KEY = ' + JSON.stringify(key) + ';\n';
fs.writeFileSync(out, content, 'utf8');
console.log('Wrote supabase-config.js');
