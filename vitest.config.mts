import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      NO_COLOR: '1',
    },
  },
})
