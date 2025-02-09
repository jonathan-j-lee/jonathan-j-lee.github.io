const path = require('path');

module.exports = {
   entry: {
      'app': './app/index.ts',
   },
   output: {
       filename: '[name].js',
       path: path.resolve(__dirname, 'dist', 'assets'),
   },
   resolve: {
       extensions: ['.ts', '.js'],
   },
   module: {
       rules: [{ test: /\.ts$/, loader: 'ts-loader' }],
   },
};
