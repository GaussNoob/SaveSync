export default {
  darkMode: 'class',
  content: ['./dashboard/index.html', './dashboard/src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        base: '#0d0f14',
        surface: '#111318',
        elevated: '#161925',
        accent: '#7c3aed'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  },
  plugins: []
};
