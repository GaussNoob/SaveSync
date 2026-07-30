export default {
  darkMode: 'class',
  content: ['./dashboard/index.html', './dashboard/src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        canvas: '#06060c',
        sidebar: '#08080f',
        panel: '#0f0f18',
        surface: '#16161f',
        raised: '#1f1f2c',
        line: {
          DEFAULT: '#232334',
          strong: '#34344c'
        },
        ink: {
          DEFAULT: '#f3f4fa',
          muted: '#a4a6bd',
          subtle: '#72748d'
        },
        accent: {
          DEFAULT: '#22d3ee',
          hover: '#67e8f9',
          pressed: '#0ea5c4',
          soft: '#0a2a34',
          ink: '#03131a'
        },
        plasma: {
          DEFAULT: '#8b5cf6',
          hover: '#a78bfa',
          soft: '#171132'
        },
        blaze: {
          DEFAULT: '#f472b6',
          soft: '#2a1024'
        },
        state: {
          success: '#34e5a0',
          warning: '#fbbf24',
          danger: '#ff5470'
        }
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Chakra Petch', 'Inter Variable', 'Inter', 'ui-sans-serif', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace']
      },
      borderRadius: {
        xs: '5px',
        sm: '8px',
        md: '12px',
        lg: '16px'
      },
      spacing: {
        sidebar: '248px',
        topbar: '68px',
        content: '32px'
      },
      boxShadow: {
        panel: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 24px 48px -32px rgb(0 0 0 / 0.9)',
        raised: '0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 18px 36px -20px rgb(0 0 0 / 0.85)',
        popover: '0 24px 60px -12px rgb(0 0 0 / 0.75), 0 0 0 1px rgb(255 255 255 / 0.05)',
        glow: '0 0 0 1px rgb(34 211 238 / 0.35), 0 12px 32px -12px rgb(34 211 238 / 0.55)',
        'glow-soft': '0 0 20px -4px rgb(34 211 238 / 0.4)',
        'glow-plasma': '0 0 0 1px rgb(139 92 246 / 0.35), 0 12px 32px -12px rgb(139 92 246 / 0.5)',
        'glow-danger': '0 0 0 1px rgb(255 84 112 / 0.35), 0 12px 32px -14px rgb(255 84 112 / 0.5)'
      },
      transitionDuration: {
        ui: '200ms'
      },
      transitionTimingFunction: {
        ui: 'cubic-bezier(0.16, 1, 0.3, 1)'
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '70%, 100%': { transform: 'scale(2.6)', opacity: '0' }
        },
        aurora: {
          '0%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '100%': { transform: 'translate3d(-3%, 2%, 0) scale(1.12)' }
        },
        shimmer: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' }
        },
        'sweep-x': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' }
        }
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        aurora: 'aurora 26s ease-in-out infinite alternate',
        shimmer: 'shimmer 2.4s ease-in-out infinite',
        'sweep-x': 'sweep-x 3s linear infinite'
      }
    }
  },
  plugins: []
};
