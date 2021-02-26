cd client_src
git clone https://github.com/civ13/typespess-client
git reset --hard origin/main
git pull
tsc
node compile.js
cd -
npm run package