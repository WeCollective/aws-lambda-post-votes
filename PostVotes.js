const AWS = require('aws-sdk');

const db = new AWS.DynamoDB.DocumentClient();

exports.handler = (event, context, callback) => {
  console.log(JSON.stringify(event, null, 2));

  const dbOperationsPromisesArr = [];

  event.Records.forEach(record => {
    if (record.eventName !== 'MODIFY') return;
    console.log('DynamoDB Record: %j', record.dynamodb);

    const branchid = record.dynamodb.Keys.branchid.S;
    const id = record.dynamodb.Keys.id.S;

    // Fetch the TableName from the event ARN of the form:
    // arn:aws:dynamodb:us-east-1:111111111111:table/test/stream/2020-10-10T08:18:22.385
    // see: http://stackoverflow.com/questions/35278881/how-to-get-the-table-name-in-aws-dynamodb-trigger-function
    const TableName = record.eventSourceARN
      .split(':')[5]
      .split('/')[1];

    // Update individual stat if an up/down vote has been cast
    if (record.dynamodb.OldImage.up && record.dynamodb.NewImage.up &&
      record.dynamodb.OldImage.down && record.dynamodb.NewImage.down &&
      (record.dynamodb.OldImage.up.N !== record.dynamodb.NewImage.up.N ||
      record.dynamodb.OldImage.down.N !== record.dynamodb.NewImage.down.N)) {

      // Update the post's individual stat on this branch.
      dbOperationsPromisesArr.push(new Promise((resolve, reject) => {
        // Ensure post still exists.
        db.get({
          Key: {
            branchid,
            id,
          },
          TableName,
        }, (err, data) => {
          if (err) {
            console.error('Error fetching item:', err);
            return reject(err);
          }

          if (!data || !data.Item) {
            console.error('Item no longer exists: %j', { branchid, id });
            return resolve();
          }

          db.update({
            AttributeUpdates: {
              individual: {
                Action: 'PUT',
                Value: Number(record.dynamodb.NewImage.up.N) - Number(record.dynamodb.NewImage.down.N),
              },
            },
            Key: {
              branchid,
              id,
            },
            TableName,
          }, (err, data) => {
            if (err) {
              console.log('Error updating item', err);
              return reject(err);
            }

            return resolve();
          });
        });
      }));
    }

    // Update local stats if the individual stat has been updated.
    if (record.dynamodb.OldImage.individual && record.dynamodb.NewImage.individual &&
      record.dynamodb.OldImage.individual.N !== record.dynamodb.NewImage.individual.N) {
      const tagTableName = (TableName.includes('dev') ? 'dev' : '') + 'Tags';
      const Value = Number(record.dynamodb.NewImage.individual.N) - Number(record.dynamodb.OldImage.individual.N);

      dbOperationsPromisesArr.push(new Promise((resolve, reject) => {
        // Get the tags of this branch, which indicate all the branches above it in the tree.
        db.query({
          
          KeyConditionExpression: "branchid = :id",
          ExpressionAttributeValues: {
            ':id': branchid,
          },
          TableName: tagTableName,
        }, (err, data) => {
          if (err) {
            return reject(err);
          }

          if (!data || !data.Items) {
            return reject('Error fetching branch tags');
          }

          // Update the post's local stat on each tagged branch.
          const updatesPromisesArr = [];

          data.Items.forEach(item => {
            updatesPromisesArr.push(new Promise((resolve, reject) => {
              // Ensure item exists.
              db.get({
                Key: {
                  branchid: item.tag,
                  id,
                },
                TableName,
              }, (err, data) => {
                if (err) {
                  console.error('Error fetching item:', err);
                  return reject(err);
                }

                if (!data || !data.Item) {
                  console.error('Item no longer exists: %j', {
                    branchid: item.tag,
                    id,
                  });
                  return resolve();
                }

                db.update({
                  AttributeUpdates: {
                    local: {
                      Action: 'ADD',
                      Value,
                    },
                  },
                  Key: {
                    branchid: item.tag,
                    id,
                  },
                  TableName,
                }, (err, data) => {
                  if (err) {
                    console.error('Error updating item:', err);
                    return reject(err);
                  }

                  return resolve();
                });
              });
            }));
          });

          Promise.all(updatesPromisesArr)
            .then(resolve)
            .catch(reject);
        });
      }));
    }

    // If local stat is updated on the root branch, update the post's global stat on all branches.
    if (record.dynamodb.OldImage.local && record.dynamodb.NewImage.local &&
      record.dynamodb.OldImage.local.N !== record.dynamodb.NewImage.local.N &&
      branchid === 'root') {

      // Fetch post on all branches.
      dbOperationsPromisesArr.push(new Promise((resolve, reject) => {
        db.query({
          ExpressionAttributeValues: {
            ':id': id,
          },
          KeyConditionExpression: 'id = :id',
          TableName,
        }, (err, data) => {
          if (err) {
            return reject(err);
          }

          if (!data || !data.Items) {
            return reject();
          }

          // Set the post global stat on all post items to the local stat on the root branch.
          const updatesPromisesArr = [];

          data.Items.forEach(item => {
            updatesPromisesArr.push(new Promise((resolve, reject) => {
              // Ensure item exists.
              db.get({
                Key: {
                  branchid: item.branchid,
                  id: item.id,
                },
                TableName,
              }, (err, data) => {
                if (err) {
                  console.error('Error fetching item:', err);
                  return reject(err);
                }

                if (!data || !data.Item) {
                  console.error('Item no longer exists: %j', {
                    branchid: item.branchid,
                    id: item.id,
                  });
                  return resolve();
                }

                db.update({
                  AttributeUpdates: {
                    global: {
                      Action: 'PUT',
                      Value: Number(record.dynamodb.NewImage.local.N),
                    },
                  },
                  Key: {
                    branchid: item.branchid,
                    id: item.id,
                  },
                  TableName,
                }, (err, data) => {
                  if (err) {
                    console.error('Error updating item:', err);
                    return reject(err);
                  }

                  return resolve();
                });
              });
            }));
          });

          Promise.all(updatesPromisesArr)
            .then(resolve)
            .catch(reject);
        });
      }));
    }
  });

  Promise.all(dbOperationsPromisesArr)
    .then(() => callback(null, 'Successfully updated stats!'))
    // Don't indicate error to lambda so it continues anyway!
    .catch(err => {
      console.log('Error updating stats: %j', err);
      callback(null, `Error updating stats: ${JSON.stringify(err)}`);
    });
};
