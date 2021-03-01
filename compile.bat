call curl -o resources.zip https://github.com/Civ13/civ13-typespess/raw/master/resources.zip
call 7z x resources.zip -y
cd client_src
call git reset --hard origin/main
call git pull
call npm install
call npx tsc -p tsconfig.json
call node compile.js "./../resources/"
cd..
cd resources
call npm install
call npm run package-windows