FROM bluenviron/mediamtx:1.21.3 AS upstream
FROM alpine:3.22
RUN apk add --no-cache iptables su-exec
COPY --from=upstream /mediamtx /usr/local/bin/mediamtx
COPY deploy/mediamtx/egress.sh /usr/local/bin/media-egress
RUN chmod 755 /usr/local/bin/media-egress
USER root
ENTRYPOINT ["/usr/local/bin/media-egress"]
