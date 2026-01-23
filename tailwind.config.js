/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary action colors (blue scale)
        primary: {
          DEFAULT: '#3b82f6', // blue-500
          hover: '#2563eb',   // blue-600
          light: '#dbeafe',   // blue-100
          dark: '#1e40af',    // blue-800
        },
        // Surface colors (gray scale for backgrounds, borders)
        surface: {
          DEFAULT: '#ffffff',
          secondary: '#f9fafb', // gray-50
          tertiary: '#f3f4f6',  // gray-100
          border: '#e5e7eb',    // gray-200
          muted: '#9ca3af',     // gray-400
          emphasis: '#1f2937',  // gray-800
        },
        // Accent colors (green for active/success states)
        accent: {
          DEFAULT: '#10b981',   // green-500
          light: '#d1fae5',     // green-100
          lighter: '#ecfdf5',   // green-50
          dark: '#047857',      // green-700
        },
        // Semantic colors
        semantic: {
          success: '#10b981',   // green-500
          'success-bg': '#d1fae5',
          error: '#ef4444',     // red-500
          'error-bg': '#fee2e2',
          warning: '#f59e0b',   // amber-500
          'warning-bg': '#fef3c7',
          info: '#3b82f6',      // blue-500
          'info-bg': '#dbeafe',
        },
      },
      // Semantic spacing for consistent layout
      spacing: {
        'panel': '24rem',  // 384px - default panel width
      },
    },
  },
  plugins: [],
}
