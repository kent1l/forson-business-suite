FROM postgres:15-alpine

# Install rclone, rsync, openssh-client, curl, tzdata, and supercronic
ARG SUPERCRONIC_VERSION=v0.2.29
ARG SUPERCRONIC_ARCH=amd64

ENV TZ=Asia/Manila

RUN apk add --no-cache rclone rsync openssh-client curl tzdata && \
    curl -fsSLo /usr/local/bin/supercronic \
        "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${SUPERCRONIC_ARCH}" && \
    chmod +x /usr/local/bin/supercronic

