#!/usr/bin/env node

var fs = require('fs');
var util = require('util');
var colors = require('colors');
var csv = require('csv');
var rest = require('restler');
var async = require('async');
var _ = require('lodash');
var argv = require('optimist')
    .demand(['i', 'c', 'g', 'p', 't', 's'])
    .alias('i', 'input')
    .alias('c', 'config')
    .alias('g', 'gitlaburl')
    .alias('p', 'project')
    .alias('t', 'token')
    .alias('s', 'sudo')
    .describe('i', 'CSV file exported from Mantis (Example: issues.csv)')
    .describe('c', 'Configuration file (Example: config.json)')
    .describe('g', 'GitLab URL hostname (Example: https://gitlab.com)')
    .describe('p', 'GitLab project name including namespace (Example: mycorp/myproj)')
    .describe('t', 'An admin user\'s private token (Example: a2r33oczFyQzq53t23Vj)')
    .describe('s', 'The username performing the import (Example: bob)')
    .argv;

var inputFile = __dirname + '/' + argv.input;
var configFile = __dirname + '/' + argv.config;
var gitlabAPIURLBase = argv.gitlaburl + '/api/v3';
var gitlabProjectName = argv.project;
var gitlabAdminPrivateToken = argv.token;
var gitlabSudo = argv.sudo;
var config = {};

getGitLabProject(gitlabProjectName, gitlabAdminPrivateToken, function(error, project) {
  if (error) {
    console.error('Error: Cannot get list of projects from gitlab: ' + gitlabAPIURLBase);
    return;
  }

  if (!project) {
    console.error('Error: Cannot find GitLab project: ' + gitlabProjectName);
    return;
  }

  getGitLabUsers(gitlabAdminPrivateToken, function(error, gitlabUsers) {
    if (error) {
      console.error('Error: Cannot get list of users from gitlab: ' + gitlabAPIURLBase);
      return;
    }

    getConfig(configFile, function(error, cfg) {
      if (error) {
        console.error('Error: Cannot read config file: ' + configFile);
        return;
      }

      config = cfg;

      var users = config.users;

      setGitLabUserIds(users, gitlabUsers);

      readRows(inputFile, function(error, rows) {
        if (error) {
          console.error('Error: Cannot read input file: ' + inputFile);
          return;
        }

        validate(rows, users, function(missingUsernames, missingNames) {
          if (missingUsernames.length > 0 || missingNames.length > 0) {
            for (var i = 0; i < missingUsernames.length; i++)
              console.error('Error: Cannot map Mantis user with username: ' + missingUsernames[i]);

            for (var i = 0; i < missingNames.length; i++)
              console.error('Error: Cannot map Mantis user with name: ' + missingNames[i]);

            return;
          }

          rows = _.sortBy(rows, function(row) { return Date.parse(row.Created); });

          async.eachSeries(rows, function(row, callback) {
            var issueId = row.Id;
            var title = row.Summary;
            var description = getDescription(row);
            var assignee = getUserByMantisUsername(users, row["Assigned To"]);
            var milestoneId = '';
            var labels = getLabels(row);
            var author = getUserByMantisUsername(users, row.Reporter);

            insertIssue(project.id, title, description, assignee && assignee.gl_id, milestoneId, labels, author.gl_username, gitlabAdminPrivateToken, function(error, issue) {
              setTimeout(callback, 1000);

              if (error) {
                console.error((issueId + ': Failed to insert.').red, error);
                return;
              }

              if (isClosed(row)) {
                closeIssue(issue, assignee.gl_private_token || gitlabAdminPrivateToken, function(error) {
                  if (error)
                    console.warn((issueId + ': Inserted successfully but failed to close. #' + issue.iid).yellow);
                  else
                    console.error((issueId + ': Inserted and closed successfully. #' + issue.iid).green);
                });

                return;
              }

              console.log((issueId + ': Inserted successfully. #' + issue.iid).green);
            });
          });
        });
      });
    });
  });
})

function getGitLabProject(name, privateToken, callback) {
  var url = gitlabAPIURLBase + '/projects';
  var data = { per_page: 100, private_token: privateToken, sudo: gitlabSudo };

  rest.get(url, {data: data}).on('complete', function(result, response) {
    if (util.isError(result)) {
      callback(result);
      return;
    }

    if (response.statusCode != 200) {
      callback(result);
      return;
    }

    for (var i = 0; i < result.length; i++) {
      if (result[i].path_with_namespace === name) {
        callback(null, result[i]);
        return;
      }
    };

    callback(null, null);
  });
}

function getGitLabUsers(privateToken, callback) {
  var url = gitlabAPIURLBase + '/users';
  var data = { per_page: 100, private_token: privateToken, sudo: gitlabSudo };

  rest.get(url, {data: data}).on('complete', function(result, response) {
    if (util.isError(result)) {
      callback(result);
      return;
    }

    if (response.statusCode != 200) {
      callback(result);
      return;
    }

    callback(null, result);
  });
}

function getConfig(configFile, callback) {
  fs.readFile(configFile, {encoding: 'utf8'}, function(error, data) {
    if (error) {
      callback(error);
      return;
    }

    var config = JSON.parse(data);
    config.users = config.users || [];

    callback(null, config);
  });
}

function setGitLabUserIds(users, gitlabUsers) {
  for (var i = 0; i < users.length; i++) {
    for (var j = 0; j < gitlabUsers.length; j++) {
      if (users[i].gl_username === gitlabUsers[j].username) {
        users[i].gl_id = gitlabUsers[j].id;
        break;
      }
    }
  }
}

function readRows(inputFile, callback) {
  fs.readFile(inputFile, {encoding: 'utf8'}, function(error, data) {
    if (error) {
      callback(error);
      return;
    }

    var rows = [];

    csv().from(data, {delimiter: ',', escape: '"', columns: true})
    .on('record', function(row, index) { rows.push(row) })
    .on('end', function() { callback(null, rows) });
  });
}

function validate(rows, users, callback) {
  var missingUsername = [];
  var missingNames = [];

  for (var i = 0; i < rows.length; i++) {
    var assignee = rows[i]["Assigned To"];

    if (!getUserByMantisUsername(users, assignee) && missingUsername.indexOf(assignee) == -1)
      missingUsername.push(assignee);
  }

  for (var i = 0; i < rows.length; i++) {
    var reporter = rows[i].Reporter;

    if (!getUserByMantisUsername(users, reporter) && missingNames.indexOf(reporter) == -1)
      missingNames.push(reporter);
  }

  callback(missingUsername, missingNames);
}

function getUserByMantisUsername(users, username) {
  return (username && _.find(users, {username: username || null })) || null;
}

function getDescription(row) {
  var attributes = [];
  var issueId = row.Id;
  var value;
  if (config.mantisUrl) {
    attributes.push("[Mantis Issue " + issueId + "](" + config.mantisUrl + "/view.php?id=" + issueId + ")");
  } else {
    attributes.push("Mantis Issue " + issueId);
  }

  if (value = row.Reporter) {
    attributes.push("Reported By: " + value);
  }

  if (value = row["Assigned To"]) {
    attributes.push("Assigned To: " + value);
  }

  if (value = row.Created) {
    attributes.push("Created: " + value);
  }

  if (value = row.Updated && value != row.Created) {
    attributes.push("Updated: " + value);
  }

  var description = "_" + attributes.join(", ") + "_\n\n";

  description += row.Description;

  if (value = row.Info) {
    description += "\n\n" + value;
  }

  return description;
}

function getLabels(row) {
  var label;
  var labels = (row.tags || []).slice(0);

  if(label = config.category_labels[row.Category]) {
    labels.push(label);
  }

  if(label = config.priority_labels[row.Priority]) {
    labels.push(label);
  }

  if(label = config.severity_labels[row.Severity]) {
    labels.push(label);
  }

  return labels.join(",");
}

function isClosed(row) {
  return config.closed_statuses[row.Status];
}

function insertIssue(projectId, title, description, assigneeId, milestoneId, labels, creatorId, privateToken, callback) {
  var url = gitlabAPIURLBase + '/projects/' + projectId + '/issues';
  var data = {
    title: title,
    description: description,
    assignee_id: assigneeId,
    milestone_id: milestoneId,
    labels: labels,
    sudo: creatorId,
    private_token: privateToken
  };

  rest.post(url, {data: data}).on('complete', function(result, response) {
    if (util.isError(result)) {
      callback(result);
      return;
    }

    if (response.statusCode != 201) {
      callback(result);
      return;
    }

    callback(null, result);
  });
}

function closeIssue(issue, privateToken, callback) {
  var url = gitlabAPIURLBase + '/projects/' + issue.project_id + '/issues/' + issue.id;
  var data = {
    state_event: 'close',
    private_token: privateToken,
    sudo: gitlabSudo
  };

  rest.put(url, {data: data}).on('complete', function(result, response) {
    if (util.isError(result)) {
      callback(result);
      return;
    }

    if (response.statusCode != 200) {
      callback(result);
      return;
    }

    callback(null);
  });
}
