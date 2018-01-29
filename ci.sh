#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

cd example
npm install

rm -Rf .cache dist
$(npm bin)/parcel build index.html
