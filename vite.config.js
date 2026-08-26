import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* 브라우저에서 공공데이터 API 를 직접 부르면 CORS 로 막히기 때문에,
   개발 서버가 대신 중계합니다. 배포 시엔 같은 경로를 서버에서 프록시하세요. */
const proxyCommon = { changeOrigin: true, secure: true };

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/openapi/lh": {
        ...proxyCommon,
        target: "https://apis.data.go.kr",
        rewrite: (p) => p.replace(/^\/openapi\/lh/, "/B552555"),
      },
      "/openapi/odcloud": {
        ...proxyCommon,
        target: "https://api.odcloud.kr",
        rewrite: (p) => p.replace(/^\/openapi\/odcloud/, "/api"),
      },
    },
  },
  build: { assetsInlineLimit: 100000000, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
});
