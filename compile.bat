npm install 7zip -g
git clone https://github.com/civ13/typespess-client client_src
curl -o resources.zip https://github.com/Civ13/civ13-typespess/raw/master/resources.zip
7z e resources.zip -oresources -y -r
cd client_src
git reset --hard origin/main
git pull
npm install
npx tsc -p tsconfig.json
node compile.js "./../resources/"
cd..
cd resources
npm install
npm run package-windows