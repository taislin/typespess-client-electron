cd resources_src
git pull
cd -
cd client_src
git reset --hard origin/main
git pull
npm install
npx tsc -p tsconfig.json
node compile.js "./../resources/"
cd -
cp -ru resources_src/resources resources
cd resources
npm install
npm run package-windows