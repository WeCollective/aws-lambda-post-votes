var AWS = require('aws-sdk');

var db = new AWS.DynamoDB.DocumentClient();

exports.handler = function(event, context, callback) {
  console.log(JSON.stringify(event, null, 2));
  var promises = [];
  event.Records.forEach(function(record) {
    console.log('DynamoDB Record: %j', record.dynamodb);

    // fetch the dbTable from the event ARN of the form:
    // arn:aws:dynamodb:us-east-1:111111111111:table/test/stream/2020-10-10T08:18:22.385
    // see: http://stackoverflow.com/questions/35278881/how-to-get-the-table-name-in-aws-dynamodb-trigger-function
    var dbTable = record.eventSourceARN.split(':')[5].split('/')[1];

    // Update individual stat if an up/down vote has been cast
    if(record.dynamodb.OldImage.up.N != record.dynamodb.NewImage.up.N ||
       record.dynamodb.OldImage.down.N != record.dynamodb.NewImage.down.N) {
      // update the post's individual stat on this branch
      promises.push(new Promise(function(resolve, reject) {
        db.update({
          TableName: dbTable,
          Key: {
            id: record.dynamodb.Keys.id.S,
            branchid: record.dynamodb.Keys.branchid.S
          },
          AttributeUpdates: {
            individual: {
              Action: 'PUT',
              Value: Number(record.dynamodb.NewImage.up.N) - Number(record.dynamodb.NewImage.down.N)
            }
          }
        }, function(err, data) {
          if(err) {
            console.log(err);
            return reject(err); // TODO: should we error out?
          }
          resolve();
        });
      }));
    }

    // Update local stats if the individual stat has been updated
    if(record.dynamodb.OldImage.individual.N != record.dynamodb.NewImage.individual.N) {
      var inc = Number(record.dynamodb.NewImage.individual.N) - Number(record.dynamodb.OldImage.individual.N);
      console.log("INCREMENTING: " + inc);
      promises.push(new Promise(function(resolve, reject) {
        // get the tags of this branch, which indicate all the branches above it in the tree
        db.query({
          TableName: dbTable,
          KeyConditionExpression: "branchid = :id",
          ExpressionAttributeValues: {
            ":id": record.dynamodb.Keys.branchid.S
          }
        }, function(err, data) {
          console.log("LOCAL CALLBACK HERE!");
          if(err) return reject(err);
          if(!data || !data.Items) {
            return reject('Error fetching branch tags');
          }

          console.log("UPDATING %j", data.Items);
          // update the post's local stat on each tagged branch
          var updates = [];
          data.Items.forEach(function(item) {
            updates.push(new Promise(function(resolve, reject) {
              db.update({
                TableName: dbTable,
                Key: {
                  id: record.dynamodb.Keys.id.S,
                  branchid: item.tag
                },
                AttributeUpdates: {
                  local: {
                    Action: 'ADD',
                    Value: inc
                  }
                }
              }, function(err, data) {
                if(err) {
                  console.log("ERROR LOCAL %j", err);
                  return reject(err); // TODO: should we error out?
                }
                console.log("SUCCESS LOCAL");
                resolve();
              });
            }));
          });
          Promise.all(updates).then(resolve, reject);
        });
      }));
    }
  });
  Promise.all(promises).then(function() {
    console.log("WOOHOO UPDATED!");
    callback(null, "Successfully updated stats!");
  }, function() {
    console.log("ERROR UPDATING");
    callback("Error updating stats!");
  });
};
