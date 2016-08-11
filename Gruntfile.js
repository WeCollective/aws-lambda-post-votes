module.exports = function(grunt) {
  // Load tasks
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-exec');
  grunt.loadNpmTasks('grunt-zip');

  // Configure tasks
  grunt.initConfig({
    // javascript linting
    jshint: {
      files: ['Gruntfile.js', 'Votes.js'],
      options: {
        node: true // tell jshint we are using nodejs to avoid incorrect errors
      }
    },
    // execute shell commands
    exec: {
      publish: 'git checkout production && git merge master && git checkout master',
      checkout: {
        cmd: function(environment) {
          var checkout;
          if(environment == 'development') {
            checkout = 'master';
          } else if(environment == 'production') {
            checkout = 'production';
          } else {
            return '';
          }
          return 'echo Checking out ' + checkout + ' && git checkout ' + checkout;
        }
      },
      deploy: {
        cmd: function(environment) {
          var checkout;
          var functionName;
          if(environment == 'development') {
            checkout = 'master';
            functionName = 'devVotes';
          } else if(environment == 'production') {
            checkout = 'production';
            functionName = 'Votes';
          } else {
            return '';
          }
          var deployCommand = 'aws lambda update-function-code --function-name ' + functionName + ' --zip-file fileb://Votes.zip --region eu-west-1 --profile weco';
          return 'echo Checking out ' + checkout + ' && git checkout ' + checkout + ' && echo Deploying... && ' + deployCommand + ' && git checkout master';
        }
      }
    },
    zip: {
      'Votes.zip': ['Votes.js', 'node_modules/**/*']
    }
  });

  /* Register main tasks.
  **    grunt build           lints the js
  */
  grunt.registerTask('build:development', ['exec:checkout:development', 'jshint', 'zip']);
  grunt.registerTask('build:production', ['exec:publish', 'exec:checkout:production', 'jshint', 'zip']);
  grunt.registerTask('deploy:development', ['build:development', 'exec:deploy:development']);
  grunt.registerTask('deploy:production', ['build:production', 'exec:deploy:production']);
};
