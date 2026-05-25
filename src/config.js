// ═════════════════════════════════════════════════════════════════════════════
// DentalFolio — Single Configuration File
// ALL branding, secrets, tiers, and static data live here.
// Edit this file to change anything app-wide without touching other code.
// ═════════════════════════════════════════════════════════════════════════════

export const DentalFolioConfig = {

  // ── Activation & Security ─────────────────────────────────────────────────
  SECRET_SALT:     's3cr3t_DentalFolio_SALT_2026',
  TIER_MAP:        { Basic: 5, Pro: 20, Premium: 50 },

  // ── Contact & Branding ────────────────────────────────────────────────────
  WHATSAPP_NUMBER: '201271476215',
  APP_NAME:        'DentalFolio',
  TAGLINE:         'Premium PDF portfolio builder for graduating dentists',

  // ── University Suggestions (datalist — field is still free text) ──
  EGYPT_FACULTIES: [
    'Egyptian Russian University Faculty of Dentistry',
    'Cairo University Faculty of Dentistry',
    'Alexandria University Faculty of Dentistry',
    'Ain Shams University Faculty of Dentistry',
    'Mansoura University Faculty of Dentistry',
    'Tanta University Faculty of Dentistry',
    'Assiut University Faculty of Dentistry',
    'Suez Canal University Faculty of Dentistry',
    'Zagazig University Faculty of Dentistry',
    'Benha University Faculty of Dentistry',
    'Minia University Faculty of Dentistry',
    'Sohag University Faculty of Dentistry',
    'South Valley University Faculty of Dentistry',
    'Fayoum University Faculty of Dentistry',
    'Modern Science and Arts University Faculty of Dentistry',
    'British University in Egypt Faculty of Dentistry',
    'Misr International University Faculty of Dentistry',
    'October 6 University Faculty of Dentistry',
    'Sinai University Faculty of Dentistry',
    'Delta University Faculty of Dentistry',
  ],

}
