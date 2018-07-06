#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

npm install
npm run test

rm -Rf .cache dist
cd example
npm install
$(npm bin)/parcel build index.html
