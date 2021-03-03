git clone https://github.com/civ13/typespess-client "client_src"
mkdir "resources_src"
cd resources_src
git init
git config core.sparseCheckout true
echo resources/ > .git/info/sparse-checkout
git remote add origin https://github.com/civ13/civ13-typespess
git fetch --depth=1 origin master
git checkout master
