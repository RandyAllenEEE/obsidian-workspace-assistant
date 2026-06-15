import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
    test: {
        environment: "jsdom",
        globals: false,
        restoreMocks: true,
        setupFiles: ["tests/setup.ts"]
    },
    resolve: {
        alias: {
            obsidian: path.resolve(__dirname, "tests/mocks/obsidian.ts")
        }
    }
});
