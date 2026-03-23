# CycleDesign Development Sandbox
# Custom sandbox image for Qwen Code
# Based on official Qwen Code sandbox image
# https://github.com/QwenLM/qwen-code

FROM ghcr.io/qwenlm/qwen-code:latest

# Install additional dependencies for CycleDesign project
RUN apk add --no-cache \
    git \
    curl \
    wget \
    libc6-compat

# Node.js and npm are already in the base image
# Project dependencies will be installed per-session

# Default entrypoint is handled by base image
