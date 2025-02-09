const path = require('path');

module.exports = {
   entry: './app/index.ts',
   output: {
       filename: 'app.js',
       path: path.resolve(__dirname, 'dist')
   },
   resolve: {
       extensions: ['.ts', '.js']
   },
   module: {
       rules: [{ test: /\.ts$/, loader: 'ts-loader' }]
   },
};
