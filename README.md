# Mantis2GitLab

Script for importing Mantis issues into (a new project in) GitLab.  The created GitLab issues will have the same
issue numbers are the corresponding Mantis issues.  Please do not use this script against a GitLab project that
has GitLab issue.

The script performs the following:

 * Reads configuration file and Mantis SVN export
 * Fetches GitLab Project and Members
 * Fetches existing issues from GitLab Project
 * For each Mantis Issue
   * If a corresonding GitLab issue exists, its Title, Description, Labels and Closed status are updated
   * Otherwise
     * If there is a "gap" in Mantis issue numbers, "Skipped Mantis Issue" GitLab issue(s) are created
     * A new GitLab issue is created with an appropriate Title, Description, Labels and Closed status

## Install

```
npm install -g nonplus/mantis2gitlab
```

## Usage

```
m2gl -i options
```

## Options

```
  -i, --input      CSV file exported from Mantis (Example: issues.csv)               [required]
  -c, --config     Configuration file (Example: config.json)                         [required]
  -g, --gitlaburl  GitLab URL hostname (Example: https://gitlab.com)                 [required]
  -p, --project    GitLab project name including namespace (Example: mycorp/myproj)  [required]
  -t, --token      An admin user's private token (Example: a2r33oczFyQzq53t23Vj)     [required]
  -s, --sudo       The username performing the import (Example: bob)                 [required]
  -f, --from       The first issue # to import (Example: 123)                      
```

## Config File

In order to correctly map Mantis attributes you should create a JSON file and specify it with the **-c** switch.

### Users

This section maps Mantis `username` (Reporter, Assigned To, etc.) to a corresponding GitLab user name.

```
{
  "users": {
    "mantisUserName1": {
      "gl_username": "GitLabUserName1"
    },
    "mantisUserName2": {
      "gl_username": "GitLabUserName2"
    }
  }
}
```

### Mantis URL (optional)

This setting defines the URL to the old mantis installation.  When specified, Mantis cases imported in GitLab
will contain a back-link to their corresponding Mantis issue.

```
{
  "mantisUrl": "https://www.oldserver.com/mantis"
}
```

### Category Labels (optional)

This section maps Mantis Categories to corresponding GitLab labels.

```
{
  "category_labels": {
    "Admin UI": "area:Admin",
    "Voter UI": "area:Voter",
    "Server": "area:Service"
    }
}
```

### Priority Labels (optional)

This section maps Mantis Priorities to corresponding GitLab labels.
Note that the numeric priorities are used when exporting from SQL.

```
{
  "priority_labels": {
    "20": "priority:low",
    "low": "priority:low",
    "40": "priority:high",
    "high": "priority:high",
    "50": "priority:urgent",
    "urgent": "priority:urgent",
    "60": "priority:immediate",
    "immediate": "priority:immediate"
  }
}
```

### Severity Labels (optional)

This section maps Mantis Severities to corresponding GitLab labels.
Note that the numeric severities are used when exporting from SQL.

```
{
  "severity_labels": {
  	"10": "severity:feature",
  	"feature": "severity:feature",
  	"20": "severity:trivial",
  	"trivial": "severity:trivial",
  	"30": "severity:text",
  	"text": "severity:text",
  	"40": "severity:tweak",
  	"tweak": "severity:tweak",
  	"50": "severity:minor",
  	"minor": "severity:minor",
  	"60": "severity:major",
  	"major": "severity:major",
  	"70": "severity:crash",
  	"crash": "severity:crash",
  	"80": "severity:block",
  	"block": "severity:block"
  }
}
```

### Closed Statuses (optional)

This section maps which Mantis Statuses indicate that the issue is closed.
Note that the numeric severities are used when exporting from SQL.

```
{
  "closed_statuses": {
  	"80": true,
  	"resolved": true,
  	"90": true,
  	"closed": true
  }
}
```

## Exporting From Mantis

The input to this script is a CSV file with the following columns:

  * `Id` - Will create a corresponding GitLab *Issue*
  * `Summary` - Will create a corresponding GitLab *Title* 
  * `Category` - Will create a corresponding GitLab *Label* from `config.category_labels[Category]` 
  * `Priority` - Will create a corresponding GitLab *Label* from `config.priority_labels[Priority]` 
  * `Severity` - Will create a corresponding GitLab *Label* from `config.severity_labels[Severity]` 
  * `Created` - Will be included in the *Description* header
  * `Updated` - Will be included in the *Description* header, if different from `Created`
  * `Reporter` - Will be included in the *Description* header
  * `Assigned To` - Will be included in the *Description* header
  * `Description` - Will be included in the *Description*
  * `Info` - Will be appended the *Description*
  * `Notes` - Will be split on `"$$$$"` and appended the *Description*

### Exporting from Mantis UI

You can export a summary of the Mantis issues from the _View Issues_ page by clicking on the _Export CSV_ button.

**Note:** This export will only include a subset of the issues and is not the recommended approach.

### Exporting from database

The following SQL query pulls all the supported columns from the Mantis database. Make sure you specify the correct `PROJECT_NAME`:

```
SELECT
	bug.id as Id,
	project.name as Project,
	bug.category as Category,
	bug.summary as Summary,
	bug.priority as Priority,
	bug.severity as Severity,
	bug.status as Status,
	bug.date_submitted as Created,
	bug.last_updated as Updated,
	reporter.username as Reporter,
	handler.username as "Assigned To",
	bug_text.description as Description,
	bug_text.additional_information as Info,
	GROUP_CONCAT(
				CONCAt('*', bugnote.date_submitted, ' - ', note_reporter.username, '*

', bugnote_text.note)
				ORDER BY bugnote.Id
				SEPARATOR '$$$$'
			) as Notes
FROM
	mantis_bug_table as bug
	JOIN mantis_project_table project ON bug.project_id = project.id
	JOIN mantis_bug_text_table bug_text ON bug.bug_text_id = bug_text.id
	JOIN mantis_user_table as reporter ON bug.reporter_id = reporter.id
	LEFT OUTER JOIN mantis_user_table as handler ON bug.handler_id = handler.id
	LEFT OUTER JOIN mantis_bugnote_table as bugnote ON bugnote.bug_id = bug.id
	LEFT OUTER JOIN mantis_bugnote_text_table as bugnote_text ON bugnote.bugnote_text_id = bugnote_text.id
	LEFT OUTER JOIN mantis_user_table as note_reporter ON bugnote.reporter_id = note_reporter.id
WHERE
	project.name = 'PROJECT_NAME'
GROUP BY bug.id
ORDER BY bug.id
```

## Notes
- Make sure the input CSV file only includes issues for the project you want to import.
- In version 6.4.3, GitLab API does not support setting creation date of issues. So all imported issues will have a creation time of now.
- In version 6.4.3, GitLab API fails to import issues with very long titles.
- In version 6.4.3, GitLab does not allow issues to be deleted. So be careful when importing issues into an active project.
- Milestones are not currently supported.

## Version History
+ **1.0**
	+ Initial release

## Author
**Stepan Riha**

+ http://github.com/nonplus

## Copyright and License

Based on https://github.com/soheilpro/youtrack2gitlab

Copyright 2015 Stepan Riha

Licensed under the The MIT License (the "License");
you may not use this work except in compliance with the License.
You may obtain a copy of the License in the LICENSE file, or at:

http://www.opensource.org/licenses/mit-license.php

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
