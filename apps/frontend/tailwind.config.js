/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: '#0B1210',
        surface: '#131B18',
        raised: '#1A2420',
        overlay: '#212E27',
        line: '#243229',
        'line-soft': '#1A241E',
        ink: '#E8F2ED',
        'ink-dim': '#8FA398',
        'ink-faint': '#54655C',
        signal: '#7C8CFF',
        'signal-dim': '#4A52A8',
        'signal-soft': 'rgba(124, 140, 255, 0.12)',
        running: '#3DDC84',
        'running-soft': 'rgba(61, 220, 132, 0.14)',
        stopped: '#8B9A92',
        'stopped-soft': 'rgba(139, 154, 146, 0.12)',
        error: '#F2545B',
        'error-soft': 'rgba(242, 84, 91, 0.14)',
        provisioning: '#F5B342',
        'provisioning-soft': 'rgba(245, 179, 66, 0.14)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: 1, boxShadow: '0 0 0 0 currentColor' },
          '50%': { opacity: 0.6 },
        },
        rise: {
          '0%': { opacity: 0, transform: 'translateY(4px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        rise: 'rise 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
