#!/usr/bin/env node

var Q = require('q');
var FS = require('q-io/fs');
var util = require('util');
var colors = require('colors');
var csv = require('csv');
var rest = require('restler-q');
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
    .alias('f', 'from')
    .describe('i', 'CSV file exported from Mantis (Example: issues.csv)')
    .describe('c', 'Configuration file (Example: config.json)')
    .describe('g', 'GitLab URL hostname (Example: https://gitlab.com)')
    .describe('p', 'GitLab project name including namespace (Example: mycorp/myproj)')
    .describe('t', 'An admin user\'s private token (Example: a2r33oczFyQzq53t23Vj)')
    .describe('s', 'The username performing the import (Example: bob)')
    .describe('f', 'The first issue # to import (Example: 123)')
    .argv;

var inputFile = __dirname + '/' + argv.input;
var configFile = __dirname + '/' + argv.config;
var fromIssueId = Number(argv.from||0);
var gitlabAPIURLBase = argv.gitlaburl + '/api/v3';
var gitlabProjectName = argv.project;
var gitlabAdminPrivateToken = argv.token;
var gitlabSudo = argv.sudo;
var config = {};

var gitLab = {};
var promise = getConfig()
        .then(readMantisIssues)
        .then(getGitLabProject)
        .then(getGitLabProjectMembers)
        .then(mapGitLabUserIds)
        .then(validateMantisIssues)
        .then(getGitLabProjectIssues)
        .then(importGitLabIssues)
    ;

promise.then(function() {
  console.log(("Done!").bold.green);
}, function(err) {
  console.error(err);
});

/**
 * Read and parse config.json file - assigns config
 */
function getConfig() {
  log_progress("Reading configuration...");
  return FS.read(configFile, {encoding: 'utf8'})
      .then(function(data) {
        var config = JSON.parse(data);
        config.users = _.extend({
          "": {
            name: "Unknown",
            gl_username: gitlabSudo
          }
        }, config.users);
        return config;
      }).then(function(cfg) {
        config = cfg;
      }, function() {
        throw new Error('Cannot read config file: ' + configFile);
      });
}

/**
 * Read and parse import.csv file - assigns gitLab.mantisIssues
 */
function readMantisIssues() {
  log_progress("Reading Mantis export file...");
  return FS.read(inputFile, {encoding: 'utf8'}).then(function(data) {
    var rows = [];
    var dfd = Q.defer();

    csv().from(data, {delimiter: ',', escape: '"', columns: true})
        .on('record', function(row, index) { rows.push(row) })
        .on('end', function(error, data) {
          dfd.resolve(rows);
        });

    return dfd.promise
        .then(function(rows) {
          _.forEach(rows, function(row) {
            row.Id = Number(row.Id);
          });

          if(fromIssueId) {
            rows = _.filter(rows, function(row) {
              return row.Id >= fromIssueId;
            })
          }

          return gitLab.mantisIssues = _.sortBy(rows, "Id");
        }, function(error) {
          throw new Error('Cannot read input file: ' + inputFile + " - " + error);
        });
  });
}

/**
 * Fetch project info from GitLab - assigns gitLab.project
 */
function getGitLabProject() {
  log_progress("Fetching project from GitLab...");
  var url = gitlabAPIURLBase + '/projects';
  var data = { per_page: 100, private_token: gitlabAdminPrivateToken, sudo: gitlabSudo };

  return rest.get(url, {data: data}).then(function(result) {

    gitLab.project = _.find(result, { path_with_namespace : gitlabProjectName }) || null;

    if (!gitLab.project) {
      throw new Error('Cannot find GitLab project: ' + gitlabProjectName);
    }

    return gitLab.project;
  }, function(error) {
    throw new Error('Cannot get list of projects from gitlab: ' + url);
  });
}

/**
 * Fetch project members from GitLab - assigns gitLab.gitlabUsers
 */
function getGitLabProjectMembers() {
  log_progress("getGitLabProjectMembers");
  var url = gitlabAPIURLBase + '/projects/' + gitLab.project.id + "/members";
  var data = { per_page: 100, private_token: gitlabAdminPrivateToken, sudo: gitlabSudo };

  return rest.get(url, {data: data}).then(function(result) {
    return gitLab.gitlabUsers = result;
  }, function(error) {
    throw new Error('Cannot get list of users from gitlab: ' + url);
  });
}

/**
 * Sets config.users[].gl_id based gitLab.gitlabUsers
 */
function mapGitLabUserIds() {
  var users = config.users,
      gitlabUsers = gitLab.gitlabUsers;
  _.forEach(users, function(user) {
    user.gl_id = (_.find(gitlabUsers, { id: user.gl_username }) || {}).id;
  });
}

/**
 * Ensure that Mantise user names in gitLab.mantisIssues have corresponding GitLab user mapping
 */
function validateMantisIssues() {
  log_progress("Validating Mantis Users...");

  var mantisIssues = gitLab.mantisIssues;
  var users = config.users;

  var missingUsernames = [];

  for (var i = 0; i < mantisIssues.length; i++) {
    var assignee = mantisIssues[i]["Assigned To"];

    if (!getUserByMantisUsername(assignee) && missingUsernames.indexOf(assignee) == -1)
      missingUsernames.push(assignee);
  }

  for (var i = 0; i < mantisIssues.length; i++) {
    var reporter = mantisIssues[i].Reporter;

    if (!getUserByMantisUsername(reporter) && missingUsernames.indexOf(reporter) == -1)
      missingUsernames.push(reporter);
  }

  if (missingUsernames.length > 0) {
    for (var i = 0; i < missingUsernames.length; i++)
      console.error('Error: Cannot map Mantis user with username: ' + missingUsernames[i]);

    throw new Error("User Validation Failed");
  }
}

/**
 * Import gitLab.mantisIssues into GitLab
 * @returns {*}
 */
function importGitLabIssues() {
  log_progress("Importing Mantis issues into GitLab from #" + fromIssueId + " ...");
  return _.reduce(gitLab.mantisIssues, function(p, mantisIssue) {
    return p.then(function() {
      return importIssue(mantisIssue);
    });
  }, Q());

}

function importIssue(mantisIssue) {
  var issueId = mantisIssue.Id;
  var title = mantisIssue.Summary;
  var description = getDescription(mantisIssue);
  var assignee = getUserByMantisUsername(mantisIssue["Assigned To"]);
  var milestoneId = '';
  var labels = getLabels(mantisIssue);
  var author = getUserByMantisUsername(mantisIssue.Reporter);

  log_progress("Importing: #" + issueId + " - " + title + " ...");

  var data = {
    title: title,
    description: description,
    assignee_id: assignee && assignee.gl_id,
    milestone_id: milestoneId,
    labels: labels,
    sudo: gitlabSudo,
    private_token: gitlabAdminPrivateToken
  };

  return getIssue(gitLab.project.id, issueId)
      .then(function(gitLabIssue) {
        if (gitLabIssue) {
          return updateIssue(gitLab.project.id, gitLabIssue.id, _.extend({
            state_event: isClosed(mantisIssue) ? 'close' : 'reopen'
          }, data))
              .then(function() {
                console.log(("#" + issueId + ": Updated successfully.").green);
              });
        } else {
          return insertSkippedIssues(issueId-1)
              .then(function() {
                return insertAndCloseIssue(issueId, data, isClosed(mantisIssue));
              });
        }
      });
}

function insertSkippedIssues(issueId) {
  if (gitLab.gitlabIssues[issueId]) {
    return Q();
  }

  console.warn(("Skipping Missing Mantis Issue (<= #" + issueId + ") ...").yellow);

  var data = {
    title: "Skipped Mantis Issue",
    sudo: gitlabSudo,
    private_token: gitlabAdminPrivateToken
  };

  return insertAndCloseIssue(issueId, data, true, getSkippedIssueData)
      .then(function() {
        return insertSkippedIssues(issueId);
      });

  function getSkippedIssueData(gitLabIssue) {
    var issueId = gitLabIssue.iid;
    var description;
    if (config.mantisUrl) {
      description = "[Mantis Issue " + issueId + "](" + config.mantisUrl + "/view.php?id=" + issueId + ")";
    } else {
      description = "Mantis Issue " + issueId;
    }
    return {
      title: "Skipped Mantis Issue " + issueId,
      description: "_Skipped " + description + "_"
    };
  }
}

function insertAndCloseIssue(issueId, data, close, custom) {

  return insertIssue(gitLab.project.id, data).then(function(issue) {
    gitLab.gitlabIssues[issue.iid] = issue;
    if (close) {
      return closeIssue(issue, custom && custom(issue)).then(
          function() {
            console.log((issueId + ': Inserted and closed successfully. #' + issue.iid).green);
          }, function(error) {
            console.warn((issueId + ': Inserted successfully but failed to close. #' + issue.iid).yellow);
          });
    }

    console.log((issueId + ': Inserted successfully. #' + issue.iid).green);
  }, function(error) {
    console.error((issueId + ': Failed to insert.').red, error);
  });
}

/**
 * Fetch all existing project issues from GitLab - assigns gitLab.gitlabIssues
 */
function getGitLabProjectIssues() {
  return getRemainingGitLabProjectIssues(0, 100)
      .then(function(result) {
        log_progress("Fetched " + result.length + " GitLab issues.");
        var issues = _.indexBy(result, 'iid');
        return gitLab.gitlabIssues = issues;
      });
}

/**
 * Recursively fetch the remaining issues in the project
 * @param page
 * @param per_page
 */
function getRemainingGitLabProjectIssues(page, per_page) {
  var from = page * per_page;
  log_progress("Fetching Project Issues from GitLab [" + (from + 1) + "-" + (from + per_page) + "]...");
  var url = gitlabAPIURLBase + '/projects/' + gitLab.project.id + "/issues";
  var data = {
    page: page,
    per_page: per_page,
    order_by: 'id',
    private_token: gitlabAdminPrivateToken, sudo: gitlabSudo };

  return rest.get(url, {data: data}).then(function(issues) {
    if(issues.length < per_page) {
      return issues;
    }
    return getRemainingGitLabProjectIssues(page+1, per_page)
        .then(function(remainingIssues) {
          return issues.concat(remainingIssues);
        });
  }, function(error) {
    throw new Error('Cannot get list of issues from gitlab: ' + url + " page=" + page);
  });
}

function getUserByMantisUsername(username) {
  return (username && config.users[username]) || config.users[""] || null;
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

  if (value = row.Notes) {
    description += "\n\n" + value.split("$$$$").join("\n\n")
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

function getIssue(projectId, issueId) {
  return Q(gitLab.gitlabIssues[issueId]);
  //
  //var url = gitlabAPIURLBase + '/projects/' + projectId + '/issues?iid=' + issueId;
  //var data = { private_token: gitlabAdminPrivateToken, sudo: gitlabSudo };
  //
  //return rest.get(url, {data: data})
  //    .then(function(issues) {
  //      var issue = issues[0];
  //      if(!issue) {
  //        throw new Error("Issue not found: " + issueId);
  //      }
  //      return issue;
  //    });
}

function insertIssue(projectId, data) {
  var url = gitlabAPIURLBase + '/projects/' + projectId + '/issues';

  return rest.post(url, {data: data})
      .then(null, function(error) {
        throw new Error('Failed to insert issue into GitLab: ' + url);
      });
}

function updateIssue(projectId, issueId, data) {
  var url = gitlabAPIURLBase + '/projects/' + projectId + '/issues/' + issueId;

  return rest.put(url, {data: data})
      .then(null, function(error) {
        throw new Error('Failed to update issue in GitLab: ' + url + " " + JSON.stringify(error));
      });
}

function closeIssue(issue, custom) {
  var url = gitlabAPIURLBase + '/projects/' + issue.project_id + '/issues/' + issue.id;
  var data = _.extend({
    state_event: 'close',
    private_token: gitlabAdminPrivateToken,
    sudo: gitlabSudo
  }, custom);

  return rest.put(url, {data: data})
      .then(null, function(error) {
        throw new Error('Failed to close issue in GitLab: ' + url);
      });
}


function log_progress(message) {
  console.log(message.grey);
}