const isVitest = process.env.VITEST;

export default {
  plugins: isVitest ? [] : ["@tailwindcss/postcss"],
};
