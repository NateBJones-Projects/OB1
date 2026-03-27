FROM denoland/deno:2.1.4

WORKDIR /app

COPY server/deno.json .
COPY server/index.ts .

RUN deno cache index.ts

EXPOSE 3000

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "index.ts"]
