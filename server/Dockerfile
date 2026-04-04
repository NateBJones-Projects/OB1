FROM denoland/deno:2.3.3

WORKDIR /app

COPY deno.json index.ts ./
RUN chown -R deno:deno /app

USER deno

RUN deno install

EXPOSE 8000

CMD ["deno", "run", "--allow-net", "--allow-env", "index.ts"]
