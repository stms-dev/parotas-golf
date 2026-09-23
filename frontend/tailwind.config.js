/**
 * Sistema de diseño "Las Parotas Editorial SaaS".
 *
 * Los tokens salen tal cual de DESIGN.md: no se inventan colores ni tamaños
 * aquí. Si el diseño cambia, se cambia este archivo y la aplicación entera
 * se mueve con él.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // --- Superficies ---
        surface: '#f9f9f6',
        'surface-dim': '#dadad7',
        'surface-bright': '#f9f9f6',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f4f4f1',
        'surface-container': '#eeeeeb',
        'surface-container-high': '#e8e8e5',
        'surface-container-highest': '#e2e3e0',
        'surface-variant': '#e2e3e0',
        'surface-tint': '#436557',
        'on-surface': '#1a1c1b',
        'on-surface-variant': '#414844',
        'inverse-surface': '#2f312f',
        'inverse-on-surface': '#f1f1ee',

        // --- Contornos ---
        outline: '#717974',
        'outline-variant': '#c1c8c3',

        // --- Verde césped (primario) ---
        primary: '#002218',
        'on-primary': '#ffffff',
        'primary-container': '#16382c',
        'on-primary-container': '#7ea292',
        'inverse-primary': '#aacfbe',
        'primary-fixed': '#c5ebd9',
        'primary-fixed-dim': '#aacfbe',
        'on-primary-fixed': '#002116',
        'on-primary-fixed-variant': '#2c4d40',

        // --- Latón (secundario) ---
        secondary: '#725b38',
        'on-secondary': '#ffffff',
        'secondary-container': '#fedeb2',
        'on-secondary-container': '#78603e',
        'secondary-fixed': '#fedeb2',
        'secondary-fixed-dim': '#e0c298',
        'on-secondary-fixed': '#281800',
        'on-secondary-fixed-variant': '#584323',

        // --- Terciario ---
        tertiary: '#082118',
        'on-tertiary': '#ffffff',
        'tertiary-container': '#1e372c',
        'on-tertiary-container': '#85a092',
        'tertiary-fixed': '#cce9d9',
        'tertiary-fixed-dim': '#b1cdbe',
        'on-tertiary-fixed': '#062016',
        'on-tertiary-fixed-variant': '#334c40',

        // --- Error ---
        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',

        background: '#f9f9f6',
        'on-background': '#1a1c1b',

        // --- Paleta operativa de estados (DESIGN.md) ---
        estado: {
          'ok-bg': '#ebf7ee',
          'ok-text': '#0d5f3a',
          'ok-border': '#bce7c7',
          'pend-bg': '#fef3c7',
          'pend-text': '#92400e',
          'pend-border': '#fde68a',
          'recibido-bg': '#eef2ff',
          'recibido-text': '#1e40af',
          'recibido-border': '#c7d2fe',
          'fin-bg': '#f1f5f9',
          'fin-text': '#475569',
          'fin-border': '#cbd5e1',
          'cancel-bg': '#ffe4e6',
          'cancel-text': '#9f1239',
          'cancel-border': '#fecdd3',
        },
      },

      // Geometría sobria: esquinas de 4px en controles, 8px en tarjetas.
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },

      spacing: {
        gutter: '1.5rem',
        margin: '2rem',
        'gutter-mobile': '1rem',
        'margin-mobile': '1rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2.5rem',
      },

      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      fontSize: {
        'display-lg': ['40px', { lineHeight: '48px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-sm': ['30px', { lineHeight: '38px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-lg': ['28px', { lineHeight: '36px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-md': ['22px', { lineHeight: '30px', fontWeight: '500' }],
        'title-lg': ['18px', { lineHeight: '24px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'title-md': ['15px', { lineHeight: '20px', fontWeight: '600' }],
        'body-lg': ['15px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md': ['13px', { lineHeight: '20px', fontWeight: '400' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '600' }],
        'label-sm': ['11px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '600' }],
        'time-slot': ['12px', { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '700' }],
      },

      // Sin sombras sintéticas pesadas: elevación por contorno y tono cálido.
      boxShadow: {
        card: '0 1px 3px rgba(22, 56, 44, 0.03), 0 6px 16px rgba(22, 56, 44, 0.02)',
        'card-hover': '0 4px 12px rgba(22, 56, 44, 0.06)',
        modal: '0 20px 40px -10px rgba(15, 40, 30, 0.15)',
      },
    },
  },
  plugins: [],
};
