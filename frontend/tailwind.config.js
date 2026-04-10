/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: '#FF8081',
        'accent-dark': '#ff6b6c',
      },
    },
  },
  plugins: [],
  darkMode: 'class', // Enable dark mode with 'class' strategy
}
