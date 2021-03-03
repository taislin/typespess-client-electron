call git clone https://github.com/civ13/typespess-client client_src
mkdir resources_src
cd resources_src
call git init
call git config core.sparseCheckout true
cd .git
cd info
echo resources/ > sparse-checkout
cd..
cd..
call git remote add origin https://github.com/civ13/civ13-typespess
call git fetch --depth=1 origin master
call git checkout master
