FROM postgres:15-alpine

# Install rclone, rsync, openssh-client, and supercronic
# supercronic is a container-safe cron daemon that reads crontab files
ARG SUPERCRONIC_VERSION=v0.2.29
ARG SUPERCRONIC_ARCH=amd64

RUN apk add --no-cache rclone rsync openssh-client curl && \
    curl -fsSLo /usr/local/bin/supercronic \
        "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${SUPERCRONIC_ARCH}" && \
    chmod +x /usr/local/bin/supercronic
