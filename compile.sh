git clone https://github.com/civ13/typespess-client client_src
cd client_src
git reset --hard origin/main
git pull
npm install
npx tsc -p tsconfig.json
node compile.js "./../resources/"
cd -
cd resources
npm install
npm run package-linux