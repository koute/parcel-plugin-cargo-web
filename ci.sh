#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

npm install

cd example
npm install

rm -Rf .cache dist
$(npm bin)/parcel build index.html
