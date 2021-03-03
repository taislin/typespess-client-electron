cd resources_src
call git pull
cd..
cd client_src
call git reset --hard origin/main
call git pull
call npm install
call npx tsc -p tsconfig.json
call node compile.js "./../resources/"
cd..
xcopy "resources_src\resources\" "resources\" /s /i /y /q
cd resources
call npm install
call npm run package-windows