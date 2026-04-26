FROM denoland/deno:2.3.3

WORKDIR /app

COPY deno.json ./
RUN deno install

COPY index.ts ./

USER deno
EXPOSE 8000

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "index.ts"]
