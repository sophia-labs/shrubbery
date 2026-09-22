FROM debian:bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-dejavu-core \
        locales \
        novnc \
        websockify \
        x11vnc \
        xdotool \
        xvfb \
    && localedef -i en_US -f UTF-8 en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV DISPLAY=:99 \
    EMULATE_BW_SCREEN=1 \
    KO_HOME=/state \
    LC_ALL=en_US.UTF-8

EXPOSE 6080

COPY entrypoint.sh /usr/local/bin/sophia-koreader-emulator

ENTRYPOINT ["/usr/local/bin/sophia-koreader-emulator"]
