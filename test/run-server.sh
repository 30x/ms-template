export PORT=3013
export COMPONENT_NAME="examples"

DIR="$(pwd)"
SOURCE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "${SOURCE_DIR}/.."

source test/local-export-pg-connection-variables.sh
node index.js