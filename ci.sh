#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

npm install
npm run test

rm -Rf .cache dist
npm run build-example

